/**
 * Estado contratual do tenant — fonte ÚNICA da verdade.
 *
 * Antes, a mesma regra estava copiada em quatro lugares (`auth.ts` duas vezes,
 * `domain/auth/google.ts` e `infra/session.ts`), com listas ligeiramente
 * diferentes. Ao introduzir `pending_verification` (V3), qualquer cópia
 * esquecida deixaria uma empresa não verificada entrar no sistema.
 */

export const BLOCKED_CONTRACT_STATUSES = [
  'suspended',
  'cancelled',
  'canceled',
  'pending_verification',
] as const;

export const PENDING_VERIFICATION_STATUS = 'pending_verification';

export interface TenantStatusInput {
  contractStatus?: string | null;
  subscriptionStatus?: string | null;
}

/**
 * Um tenant bloqueado não autentica e não mantém sessão válida.
 * `pending_verification` bloqueia login de propósito: a liberação acontece pelo
 * link de e-mail, não por uma sessão já aberta.
 */
export function isTenantBlocked(tenant: TenantStatusInput | null | undefined): boolean {
  if (!tenant) return true;

  const contract = (tenant.contractStatus ?? '').trim().toLowerCase();
  if ((BLOCKED_CONTRACT_STATUSES as readonly string[]).includes(contract)) return true;

  const subscription = (tenant.subscriptionStatus ?? '').trim().toLowerCase();
  return subscription === 'canceled';
}

export function isTenantPendingVerification(tenant: TenantStatusInput | null | undefined): boolean {
  return (tenant?.contractStatus ?? '').trim().toLowerCase() === PENDING_VERIFICATION_STATUS;
}
