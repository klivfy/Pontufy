import type { NextAuthConfig } from 'next-auth';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

// NODE_ENV is 'production' during `next build` too (not just at request-serving
// runtime), and Turbopack evaluates this module while collecting page data — so
// throwing unconditionally here fails every build, including Preview deploys that
// legitimately don't carry a Production-only secret yet. NEXT_PHASE distinguishes
// the build step from an actual running server; only the latter should crash.
const isBuildPhase = process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;

if (!process.env.AUTH_SECRET && process.env.NODE_ENV === 'production' && !isBuildPhase) {
  // Fail closed: the fallback below is a fixed, publicly-readable string. Silently
  // signing production JWTs with it would let anyone who reads this source forge a
  // session (including super_admin) — crash loudly instead of degrading silently.
  throw new Error(
    '[SECURITY] AUTH_SECRET não está definido em produção. Configure a variável de ' +
      'ambiente antes de iniciar a aplicação.',
  );
}

const authSecret = process.env.AUTH_SECRET || 'pontufy-dev-insecure-replace-in-production';

// ═══════════════════════════════════════════════════════════════════════════
// Cookie de sessão seguro — decidido pelo PROTOCOLO, não por NODE_ENV
//
// A versão anterior usava `NODE_ENV === 'production'` para escolher o prefixo
// `__Host-` e o atributo `Secure`. O problema: `next start` roda com
// NODE_ENV=production mesmo servindo HTTP. Cookie `__Host-` exige HTTPS, então
// qualquer cliente compatível (navegador, Playwright) DESCARTA o cookie — a
// sessão nunca se estabelece e toda rota autenticada responde 401.
//
// Descoberto no job E2E do CI: 20 testes falhavam com 401 apesar de o login
// responder 302. Também afetava quem validava o build de produção localmente.
//
// Regra: HTTPS ⇒ cookie `__Host-` + Secure (correto em produção). HTTP com URL
// explícita ⇒ cookie simples (só acontece em ambiente controlado). Sem URL
// configurada em produção, assume-se HTTPS — o padrão seguro.
// ═══════════════════════════════════════════════════════════════════════════
const configuredAuthUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? '';
const USE_SECURE_COOKIES =
  configuredAuthUrl.startsWith('https://') ||
  (process.env.NODE_ENV === 'production' && configuredAuthUrl === '');
const SESSION_COOKIE_NAME = USE_SECURE_COOKIES
  ? '__Host-authjs.session-token'
  : 'authjs.session-token';

export const authConfig = {
  secret: authSecret,
  trustHost: true,
  providers: [],
  callbacks: {
    // Edge-safe authorization gate. NOTE: with a custom proxy handler (proxy.ts)
    // this only takes effect when returning a Response (next-auth/lib/index.js
    // runs the handler branch before the `!authorized` redirect). Kept as the
    // authoritative allowlist for public routes — the handler relies on it for
    // redirect semantics and any future matcher widening.
    async authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const pathname = nextUrl.pathname;

      const isPublicRoute =
        pathname.startsWith('/login') ||
        pathname.startsWith('/register') ||
        pathname.startsWith('/auth') ||
        pathname.startsWith('/forgot-password') ||
        pathname.startsWith('/reset-password') ||
        pathname.startsWith('/superadmin/login') ||
        pathname.startsWith('/termos') ||
        pathname.startsWith('/privacidade') ||
        pathname.startsWith('/api/auth') ||
        pathname.startsWith('/api/webhooks');

      if (isLoggedIn && pathname === '/login') {
        return Response.redirect(new URL('/dashboard', nextUrl));
      }

      if (!isLoggedIn && !isPublicRoute) {
        return false;
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tenantId = user.tenantId;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.tenantId = token.tenantId as string;
        session.user.role = token.role as string;
      }
      return session;
    }
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    // V5 — janela de 24h (era 7 dias). `updateAge` de 1h renova a sessão de
    // quem está ativo, então o efeito prático é: usuário ativo nunca reloga,
    // token esquecido em um dispositivo perde validade em 1 dia.
    maxAge: 24 * 60 * 60,
    updateAge: 60 * 60,
  },
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: USE_SECURE_COOKIES,
      },
    },
  },
} satisfies NextAuthConfig;
