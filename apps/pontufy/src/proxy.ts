import { NextResponse } from 'next/server';
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

const { auth } = NextAuth(authConfig);

// ═══════════════════════════════════════════════════════════════════════════
// TAREFA 10 — RBAC DECLARATIVO (Zero Trust)
// Regras de rota centralizadas num único mapa. Nada de `if` espalhado:
// cada prefixo declara roles permitidas e o comportamento de bloqueio.
//  • public → acessível sem sessão
//  • roles  → permitido apenas para as roles listadas
//  • opaque403 → responde 403 vazio (não vaza a existência da rota)
//  • redirectTo → redireciona (UX de páginas corporativas)
// ═══════════════════════════════════════════════════════════════════════════

interface RouteRule {
  public?: boolean;
  roles?: string[];
  redirectTo?: string;
  opaque403?: boolean;
}

const ROUTE_RULES: Array<{ prefix: string; rule: RouteRule }> = [
  // ── Públicas ────────────────────────────────────────────────────────────
  { prefix: '/api/auth', rule: { public: true } },
  // Webhooks são públicos POR NATUREZA: a assinatura (Stripe / x-pontufy-signature)
  // é validada dentro do handler — nunca no proxy (Edge não lê o segredo).
  { prefix: '/api/webhooks', rule: { public: true } },
  { prefix: '/termos', rule: { public: true } },
  { prefix: '/privacidade', rule: { public: true } },
  { prefix: '/login', rule: { public: true } },
  { prefix: '/register', rule: { public: true } },
  { prefix: '/auth', rule: { public: true } },
  { prefix: '/forgot-password', rule: { public: true } },
  { prefix: '/reset-password', rule: { public: true } },
  { prefix: '/unlock-account', rule: { public: true } },
  { prefix: '/verify-tenant', rule: { public: true } },
  { prefix: '/verify', rule: { public: true } },
  { prefix: '/superadmin/login', rule: { public: true } },

  // ── Zona Super Admin (403 opaco, sem redirect) ──────────────────────────
  { prefix: '/superadmin', rule: { roles: ['super_admin'], opaque403: true } },

  // ── Zona RH do tenant (redirect UX, sem leak) ───────────────────────────
  { prefix: '/admin', rule: { roles: ['admin_rh'], redirectTo: '/dashboard' } },
];

function matchRule(pathname: string): RouteRule | undefined {
  return ROUTE_RULES.find(({ prefix }) => pathname.startsWith(prefix))?.rule;
}

export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const role: string = req.auth?.user?.role ?? '';
  const email: string = req.auth?.user?.email ?? '';
  const tenantId: string = req.auth?.user?.tenantId ?? '';

  const rule = matchRule(pathname);

  // ── Assinatura de tenant (defesa em profundidade): o proxy carimba a
  // requisição com o tenant autenticado. Handlers continuam validando via
  // getSessionContext() — este header é camada extra contra spoofing.
  const requestHeaders = new Headers(req.headers);

  // B1 — requestId: reusa o da borda (Vercel/proxy reverso) ou gera um.
  // Vai no request (para o logger do servidor) e na resposta (para o usuário
  // reportar). Sem isso, um erro em produção não é rastreável até as linhas
  // de log daquela requisição.
  const incomingRequestId = req.headers.get('x-request-id');
  const requestId =
    incomingRequestId && /^[A-Za-z0-9_-]{8,64}$/.test(incomingRequestId)
      ? incomingRequestId
      : crypto.randomUUID();
  requestHeaders.set('x-request-id', requestId);

  if (isLoggedIn && tenantId) {
    requestHeaders.set('x-tenant-id', tenantId);
    requestHeaders.set('x-user-role', role);
  }
  const withRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };
  const passThrough = () => withRequestId(NextResponse.next({ request: { headers: requestHeaders } }));

  /**
   * 403 opaco, mas RENDERIZÁVEL.
   *
   * Antes: `new NextResponse(null, { status: 403 })`. Corpo vazio em navegação
   * faz o Chrome abortar com `net::ERR_HTTP_RESPONSE_CODE_FAILURE` — o usuário
   * via a tela de erro do navegador ("Esta página não está funcionando"), não
   * uma resposta educada. Quem chega em /superadmin sem ser super_admin (link
   * antigo, atalho, digitação) batia nisso.
   *
   * O texto continua genérico e sem dica de rota: a opacidade é de propósito.
   * Só o transporte mudou.
   */
  const opaqueForbidden = () =>
    new NextResponse(
      '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Não encontrado</title><style>' +
        'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
        'background:#f7f4ef;color:#2b2f2e;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
        'main{text-align:center;padding:2rem}code{font-size:3rem;font-weight:800;opacity:.25;display:block}' +
        'p{margin:.5rem 0 1.5rem;color:#5c5c5c}a{color:#495453;font-weight:600;text-decoration:none}' +
        'a:hover{text-decoration:underline}</style></head><body><main><code>404</code>' +
        '<p>Não encontramos esta página.</p><a href="/dashboard">Voltar ao início</a>' +
        '</main></body></html>',
      { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );

  // ── Rotas públicas ───────────────────────────────────────────────────────
  if (rule?.public) {
    // Páginas de auth: usuário logado não volta para a tela de login.
    if (isLoggedIn && (pathname.startsWith('/login') || pathname.startsWith('/register'))) {
      return withRequestId(NextResponse.redirect(new URL('/dashboard', req.nextUrl)));
    }
    if (isLoggedIn && pathname.startsWith('/superadmin/login') && role === 'super_admin' && email.endsWith('@pontufy.com')) {
      return withRequestId(NextResponse.redirect(new URL('/superadmin', req.nextUrl)));
    }
    return passThrough();
  }

  // ── Não autenticado → login corporativo ──────────────────────────────────
  if (!isLoggedIn) {
    return withRequestId(NextResponse.redirect(new URL('/login', req.nextUrl)));
  }

  // ── Zona protegida: avalia a role declarada ──────────────────────────────
  if (rule) {
    // Super Admin: domínio corporativo é requisito adicional de confiança.
    const allowed =
      rule.roles!.includes(role) &&
      (role !== 'super_admin' || email.endsWith('@pontufy.com'));

    if (!allowed) {
      if (rule.opaque403) {
        return withRequestId(opaqueForbidden());
      }
      return withRequestId(NextResponse.redirect(new URL(rule.redirectTo ?? '/dashboard', req.nextUrl)));
    }
    return passThrough();
  }

  // Rota desconhecida: autenticada por padrão (fail-closed).
  return passThrough();
});

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.json|icons/).*)',
  ],
};