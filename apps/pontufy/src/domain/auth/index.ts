import { getSessionContext } from '@/infra/session';

export { getSessionContext } from '@/infra/session';
export { hashPassword, verifyPassword } from '@/infra/crypto';
export { upsertGoogleUser, parseGoogleIntent } from './google';
export { issueGoogleBridgeTicket, verifyGoogleBridgeTicket } from './google-ticket';

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export async function requireRole(...roles: string[]) {
  const ctx = await getSessionContext();
  if (!roles.includes(ctx.role)) {
    throw new DomainError('Acesso restrito.', 403, 'FORBIDDEN');
  }
  return ctx;
}

export async function requireAdmin() {
  return requireRole('admin_rh', 'super_admin');
}

export async function requireHrAdmin() {
  return requireRole('admin_rh');
}

/**
 * Super administrador da plataforma (V5).
 *
 * Antes esta regra era copiada em cada rota como `session.user.role` +
 * `email.endsWith('@pontufy.com')` — lendo o papel do TOKEN, não do banco.
 * RebaiXar alguém não tinha efeito até o JWT expirar (7 dias).
 *
 * Agora `getSessionContext` relê papel e versão de sessão no banco, então o
 * rebaixamento corta o acesso na requisição seguinte. O domínio corporativo
 * continua sendo requisito adicional.
 */
export async function requireSuperAdmin() {
  // 403 opaco também para quem não tem sessão: a decisão registrada no
  // CLAUDE.md é não revelar a existência da rota. Antes, `getSessionContext`
  // lançava 'Não autenticado.' e o `jsonError` respondia 401 — a diferença
  // entre 401 e 403 já contava ao anônimo que a rota existe.
  let ctx: Awaited<ReturnType<typeof getSessionContext>>;
  try {
    ctx = await getSessionContext();
  } catch {
    throw new DomainError('Acesso restrito.', 403, 'FORBIDDEN');
  }

  if (ctx.role !== 'super_admin' || !ctx.email.endsWith('@pontufy.com')) {
    // 403 opaco: não confirma existência da rota nem motivo da recusa.
    throw new DomainError('Acesso restrito.', 403, 'FORBIDDEN');
  }

  return ctx;
}

export function jsonError(error: unknown) {
  if (error instanceof DomainError) {
    return { body: { error: error.message, code: error.code }, status: error.status };
  }
  if (error instanceof Error && error.message === 'Não autenticado.') {
    return { body: { error: 'Não autenticado.' }, status: 401 };
  }
  if (error instanceof Error && error.message === 'Conta não encontrada.') {
    return { body: { error: error.message }, status: 401 };
  }
  if (error instanceof Error && error.message === 'Conta da empresa inativa.') {
    return { body: { error: error.message }, status: 401 };
  }
  if (error instanceof Error && error.message === 'Sessão revogada. Entre novamente.') {
    return { body: { error: error.message, code: 'SESSION_REVOKED' }, status: 401 };
  }
  return { body: { error: 'Erro interno.' }, status: 500 };
}
