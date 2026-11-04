import { auth } from '@/auth';
import { prisma } from '@/infra/db';
import { getRedis } from '@/infra/redis';
import { isTenantBlocked } from '@/domain/tenant/status';

/**
 * Contexto autenticado do usuário, sempre relido do BANCO.
 *
 * Por que reler: o JWT é stateless. Mudar papel, remover usuário ou revogar a
 * sessão não altera o token que já está no navegador. Esta função é o ponto em
 * que o token é confrontado com a verdade do banco:
 *   • usuário ainda existe;
 *   • `sessionVersion` do token == `sessionVersion` do banco (revogação);
 *   • papel vem do banco (promoção/rebaixamento tem efeito imediato);
 *   • tenant não está bloqueado.
 */
export async function getSessionContext() {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Não autenticado.');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, tenantId: true, role: true, email: true, sessionVersion: true },
  });

  if (!user) {
    throw new Error('Conta não encontrada.');
  }

  // V5 — revogação sem Redis: o token carrega a versão de quando foi emitido.
  const tokenVersion = (session.user as { sessionVersion?: number }).sessionVersion;
  if (typeof tokenVersion === 'number' && tokenVersion !== user.sessionVersion) {
    throw new Error('Sessão revogada. Entre novamente.');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { contractStatus: true, subscriptionStatus: true },
  });

  if (isTenantBlocked(tenant)) {
    throw new Error('Conta da empresa inativa.');
  }

  return {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
    sessionVersion: user.sessionVersion,
  };
}

export async function setSingleSessionPolicy(tenantId: string, enabled: boolean): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(`single-session:${tenantId}`, enabled ? 1 : 0);
}
