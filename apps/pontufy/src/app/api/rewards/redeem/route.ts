import { NextResponse } from 'next/server';
import { getSessionContext } from '@/infra/session';
import { acquireLock, releaseLock, type LockHandle } from '@/infra/mutex';
import { jsonError } from '@/domain/auth';
import { redeemReward, PointsError } from '@/domain/rewards';
import { getClientIp, ipRateLimit } from '@/lib/security/auth-guard';
import { tenantRateLimit } from '@/lib/security/rate-limit';
import { parseBody, redeemSchema } from '@/lib/validations';
import { logger } from '@/infra/logger';

const REDEEM_IP_MAX = 20;
const REDEEM_IP_WINDOW = 60;
const REDEEM_TENANT_MAX = 200;
const REDEEM_TENANT_WINDOW = 60;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const ipRate = await ipRateLimit(ip, 'rewards-redeem', REDEEM_IP_MAX, REDEEM_IP_WINDOW);
  if (!ipRate.allowed) {
    return NextResponse.json({ error: 'Muitos resgates em sequência. Aguarde um instante.' }, { status: 429 });
  }

  let lock: LockHandle | null = null;
  try {
    const { tenantId, userId } = await getSessionContext();
    const tenantRate = await tenantRateLimit(tenantId, 'rewards-redeem', REDEEM_TENANT_MAX, REDEEM_TENANT_WINDOW);
    if (!tenantRate.allowed) {
      return NextResponse.json({ error: 'Limite da empresa atingido. Tente novamente em instantes.' }, { status: 429 });
    }

    const raw = await request.json().catch(() => null);
    const { data: body, error: validationError } = parseBody(redeemSchema, raw);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    lock = await acquireLock(`lock:redeem:${tenantId}:${userId}`, 10);
    if (!lock) {
      return NextResponse.json({ error: 'Resgate já em andamento. Aguarde.' }, { status: 429 });
    }

    const result = await redeemReward({
      tenantId,
      userId,
      rewardId: body.rewardId,
      productUrl: body.productUrl,
      productTitle: body.productTitle,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PointsError) {
      const status = error.code === 'INSUFFICIENT_BALANCE' ? 400 : 404;
      return NextResponse.json({ error: error.message, missing: error.missing }, { status });
    }
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('POST /api/rewards/redeem', { error: String(error) }, 'rewards');
    return NextResponse.json(mapped.body, { status: mapped.status });
  } finally {
    await releaseLock(lock);
  }
}
