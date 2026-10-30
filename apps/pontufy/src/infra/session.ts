import { auth } from '@/auth';
import { prisma } from '@/infra/db';
import { getRedis } from '@/infra/redis';

export async function getSessionContext() {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Não autenticado.');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, tenantId: true, role: true },
  });

  if (!user) {
    throw new Error('Conta não encontrada.');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { contractStatus: true, subscriptionStatus: true },
  });

  const tenantBlocked =
    !tenant ||
    tenant.contractStatus === 'suspended' ||
    tenant.contractStatus === 'cancelled' ||
    tenant.subscriptionStatus === 'canceled';

  if (tenantBlocked) {
    throw new Error('Conta da empresa inativa.');
  }

  return {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
  };
}

export async function setSingleSessionPolicy(tenantId: string, enabled: boolean): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(`single-session:${tenantId}`, enabled ? 1 : 0);
}
