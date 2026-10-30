import { randomUUID } from 'node:crypto';
import { getTenantDb, getRawPrisma } from '@/infra/db';
import { cacheGet, cacheSet, cacheDeletePattern } from '@/infra/redis';
import { createLomadeeTrackedLink } from '@/infra/lomadee';
import { creditPoints, debitPoints, PointsError } from '@/domain/points';
import { DomainError } from '@/domain/auth';
import { logAudit } from '@/lib/audit';
import { notifyRewardRedeemed } from '@/lib/notifications';
import { validateAffiliateUrl, sanitizeAiText } from '@/lib/validations/security';
import { logger } from '@/infra/logger';

export { PointsError };

export async function listRewards(tenantId: string, opts: { page: number; limit: number; category?: string | null }) {
  const db = getTenantDb(tenantId);
  const page = Math.max(1, opts.page);
  const limit = Math.min(50, Math.max(1, opts.limit));
  const skip = (page - 1) * limit;
  const category = opts.category || undefined;
  const cacheKey = `rewards:${tenantId}:p${page}:l${limit}:c${category || 'all'}`;
  const cached = await cacheGet<unknown>(cacheKey);
  if (cached) return cached;

  const where: { isActive: boolean; category?: string } = { isActive: true };
  if (category) where.category = category;

  const [rewards, total] = await Promise.all([
    db.reward.findMany({ where, orderBy: { pricePoints: 'asc' }, skip, take: limit }),
    db.reward.count({ where }),
  ]);

  const result = { data: rewards, total, page, limit, totalPages: Math.ceil(total / limit) };
  await cacheSet(cacheKey, result, 300);
  return result;
}

export async function listAdminRewards(tenantId: string) {
  const db = getTenantDb(tenantId);
  return db.reward.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
}

export async function toggleReward(tenantId: string, rewardId: string, isActive: boolean) {
  const db = getTenantDb(tenantId);
  const reward = await db.reward.update({ where: { id: rewardId }, data: { isActive } });
  await cacheDeletePattern(`rewards:${tenantId}:*`).catch(() => {});
  return reward;
}

export type RedeemInput = {
  tenantId: string;
  userId: string;
  rewardId?: string;
  productUrl?: string;
  pointsCost?: number;
  productTitle?: string;
};

export async function redeemReward(input: RedeemInput) {
  const db = getTenantDb(input.tenantId);

  if (input.rewardId) {
    return redeemCatalog(db, input.tenantId, input.userId, input.rewardId);
  }
  if (input.productUrl && typeof input.pointsCost === 'number' && input.pointsCost > 0) {
    return redeemLomadeeProduct(db, input.tenantId, input.userId, input.productUrl, input.pointsCost, input.productTitle);
  }
  if (input.productUrl) {
    const affiliateUrl = await createLomadeeTrackedLink(input.productUrl, `browse_${randomUUID()}`);
    return { success: true as const, affiliateUrl, browseOnly: true as const };
  }
  throw new DomainError('Requisição inválida.', 400);
}

async function redeemCatalog(db: ReturnType<typeof getTenantDb>, tenantId: string, userId: string, rewardId: string) {
  const reward = await db.reward.findFirst({ where: { id: rewardId } });
  if (!reward || !reward.isActive) {
    throw new DomainError('Recompensa indisponível ou inativa.', 404, 'REWARD_NOT_FOUND');
  }
  if (reward.originalUrl) {
    const check = validateAffiliateUrl(reward.originalUrl);
    if (!check.valid) throw new DomainError(`URL da recompensa inválida: ${check.reason}`, 400, 'INVALID_URL');
  }

  const result = await db.$transaction(async (tx: any) => {
    const updatedUser = await debitPoints(tx as never, {
      userId,
      tenantId,
      amount: reward.pricePoints,
      description: `Resgate: ${reward.title}`,
    });
    const trackingSubId = `ptfy_${tenantId.slice(0, 8)}_${userId.slice(0, 8)}_${rewardId.slice(0, 8)}_${Date.now().toString(36)}`;
    let affiliateLink = reward.affiliateUrl || reward.originalUrl;
    if (reward.partner === 'LOMADEE' && reward.originalUrl) {
      try {
        affiliateLink = await createLomadeeTrackedLink(reward.originalUrl, trackingSubId);
      } catch (e) {
        logger.warn('Failed to create Lomadee tracked link', { error: String(e) }, 'rewards');
      }
    }
    const redemption = await tx.redemption.create({
      data: {
        tenantId,
        userId,
        rewardId: reward.id,
        pointsDebited: reward.pricePoints,
        trackingSubId,
        affiliateLink,
        status: 'PENDING',
      },
    });
    return { updatedUser, redemption, reward, trackingSubId, affiliateLink };
  });

  await logAudit({
    tenantId,
    userId,
    action: 'REWARD_REDEEMED',
    entity: 'Reward',
    entityId: reward.id,
    oldValue: { pointsBalance: result.updatedUser.pointsBalance + reward.pricePoints },
    newValue: { pointsBalance: result.updatedUser.pointsBalance, rewardId, rewardTitle: reward.title },
  });

  notifyRewardRedeemed({
    tenantId,
    userId,
    rewardTitle: reward.title,
    pointsSpent: reward.pricePoints,
    link: result.affiliateLink,
  });

  return {
    success: true as const,
    message: 'Resgate concluído com sucesso!',
    newBalance: result.updatedUser.pointsBalance,
    affiliateUrl: result.affiliateLink,
    redemptionId: result.redemption.id,
    trackingSubId: result.trackingSubId,
  };
}

async function redeemLomadeeProduct(
  db: ReturnType<typeof getTenantDb>,
  tenantId: string,
  userId: string,
  productUrl: string,
  pointsCost: number,
  productTitle?: string,
) {
  const sanitizedTitle = sanitizeAiText(String(productTitle ?? productUrl).slice(0, 200));
  const result = await db.$transaction(async (tx: any) => {
    const updatedUser = await debitPoints(tx as never, {
      userId,
      tenantId,
      amount: pointsCost,
      description: `Resgate Lomadee: ${sanitizedTitle}`,
    });
    const trackingSubId = `ptfy_lomadee_${tenantId.slice(0, 8)}_${userId.slice(0, 8)}_${Date.now().toString(36)}`;
    let affiliateLink = productUrl;
    try {
      affiliateLink = await createLomadeeTrackedLink(productUrl, trackingSubId);
    } catch (e) {
      logger.warn('Failed to create Lomadee tracked link for product', { error: String(e) }, 'rewards');
    }
    const redemption = await tx.redemption.create({
      data: {
        tenantId,
        userId,
        rewardId: 'lomadee-product',
        pointsDebited: pointsCost,
        trackingSubId,
        affiliateLink,
        status: 'PENDING',
      },
    });
    return { updatedUser, redemption, trackingSubId, affiliateLink };
  });

  return {
    success: true as const,
    message: 'Resgate concluído!',
    newBalance: result.updatedUser.pointsBalance,
    affiliateUrl: result.affiliateLink,
    redemptionId: result.redemption.id,
    trackingSubId: result.trackingSubId,
  };
}

type LomadeePostbackPayload = {
  subId: string;
  orderId: string;
  orderValue: number;
  commissionValue: number;
  currency: string;
  status: string;
  conversionDate?: string;
};

export function assertLomadeePostbackToken(token: string | null) {
  const expected = process.env.LOMADEE_POSTBACK_SECRET;
  if (!expected) throw new DomainError('Configuração de segurança ausente', 500);
  if (!token || token !== expected) throw new DomainError('Token inválido', 401);
}

function mapLomadeeStatus(lomadeeStatus: string): string {
  const status = lomadeeStatus.toUpperCase();
  if (status === 'CONFIRMED' || status === 'APPROVED' || status === 'VALIDATED') return 'CONFIRMED';
  if (status === 'CANCELLED' || status === 'REJECTED' || status === 'DECLINED') return 'CANCELLED';
  return 'PENDING';
}

export async function persistCommission(event: {
  id: string;
  tenantId: string;
  network: string;
  trackingId: string;
  userId: string;
  orderId: string;
  orderValue: number;
  commissionValue: number;
  currency: string;
  status: string;
  receivedAt: string;
}): Promise<{ commissionId: string; alreadyProcessed: boolean }> {
  const db = getTenantDb(event.tenantId);
  const existing = await db.commission.findFirst({
    where: { orderId: event.orderId, network: event.network },
  });
  if (existing) return { commissionId: existing.id, alreadyProcessed: true };

  const pointsAwarded =
    event.status === 'approved' && event.commissionValue > 0
      ? Math.round(event.commissionValue * 10)
      : 0;

  const commission = await db.$transaction(async (tx: any) => {
    const created = await tx.commission.create({
      data: {
        id: event.id,
        tenantId: event.tenantId,
        network: event.network,
        trackingId: event.trackingId,
        userId: event.userId,
        orderId: event.orderId,
        orderValue: event.orderValue,
        commissionValue: event.commissionValue,
        currency: event.currency,
        status: event.status,
        pointsAwarded,
        receivedAt: new Date(event.receivedAt),
      },
    });
    if (pointsAwarded > 0) {
      await creditPoints(tx as never, {
        userId: event.userId,
        tenantId: event.tenantId,
        amount: pointsAwarded,
        description: `Comissão ${event.network} - Pedido ${event.orderId}`,
      });
    }
    return created;
  });

  return { commissionId: commission.id, alreadyProcessed: false };
}

export async function processLomadeePostback(payload: LomadeePostbackPayload) {
  if (!payload.subId) throw new DomainError('Campo subId obrigatório', 400);

  const prisma = getRawPrisma();
  const redemption = await prisma.redemption.findUnique({
    where: { trackingSubId: payload.subId },
    include: { user: true, tenant: true },
  });
  if (!redemption) {
    logger.warn('Postback for unknown trackingSubId', { subId: payload.subId }, 'postback');
    return { success: true, message: 'Resgate não encontrado, ignorado' };
  }

  const newStatus = mapLomadeeStatus(payload.status);
  const existingCommission = redemption.commissionValue ? Number(redemption.commissionValue) : 0;
  if (redemption.status === newStatus && existingCommission === payload.commissionValue) {
    return { success: true, message: 'Já processado' };
  }

  await prisma.$transaction(async (tx: any) => {
    await tx.redemption.update({
      where: { id: redemption.id },
      data: {
        status: newStatus,
        commissionValue: payload.commissionValue,
        postbackPayload: payload as object,
        updatedAt: new Date(),
      },
    });
    if (newStatus === 'CONFIRMED' && payload.commissionValue > 0) {
      await tx.commission.create({
        data: {
          tenantId: redemption.tenantId,
          network: 'LOMADEE',
          trackingId: payload.subId,
          userId: redemption.userId,
          orderId: payload.orderId,
          orderValue: payload.orderValue,
          commissionValue: payload.commissionValue,
          currency: payload.currency || 'BRL',
          status: 'approved',
          pointsAwarded: 0,
          receivedAt: new Date(payload.conversionDate || Date.now()),
        },
      });
    }
  });

  await logAudit({
    tenantId: redemption.tenantId,
    userId: redemption.userId,
    action: 'REWARD_POSTBACK_RECEIVED',
    entity: 'Redemption',
    entityId: redemption.id,
    newValue: {
      trackingSubId: payload.subId,
      status: newStatus,
      commissionValue: payload.commissionValue,
      orderId: payload.orderId,
    },
  });

  return { success: true, message: 'Postback processado', redemptionId: redemption.id, status: newStatus };
}
