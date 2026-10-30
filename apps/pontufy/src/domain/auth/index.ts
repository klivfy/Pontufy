import { getSessionContext } from '@/infra/session';

export { getSessionContext } from '@/infra/session';
export { hashPassword, verifyPassword } from '@/infra/crypto';

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
  return { body: { error: 'Erro interno.' }, status: 500 };
}
