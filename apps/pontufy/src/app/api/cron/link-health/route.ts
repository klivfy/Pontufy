import { NextRequest, NextResponse } from 'next/server';
import { getRawPrisma } from '@/infra/platform-db';
import { logger } from '@/infra/logger';
import { authorizeCronRequest } from '@/lib/security/cron-auth';
import { acquireJobLock } from '@/infra/job-lock';

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // V7 — execução única. Sem o lock, dois disparos desativam as mesmas
  // recompensas e o job paga duas vezes o custo das requisições HEAD.
  const lock = await acquireJobLock('cron:link-health');
  if (!lock.acquired) {
    return NextResponse.json({ skipped: true, reason: 'locked' }, { status: 200 });
  }

  const prisma = getRawPrisma();
  const rewards = await prisma.reward.findMany({
    where: { isActive: true, originalUrl: { not: '' } },
    select: { id: true, originalUrl: true, tenantId: true, title: true },
    take: 100,
  });

  let deactivated = 0;
  const errors: string[] = [];

  for (const reward of rewards) {
    if (!reward.originalUrl) continue;
    try {
      const res = await fetch(reward.originalUrl, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) });
      if (res.status >= 400) {
        await prisma.reward.update({ where: { id: reward.id }, data: { isActive: false } });
        deactivated += 1;
        logger.warn('Reward link unhealthy, deactivated', { rewardId: reward.id, status: res.status }, 'link-health');
      }
    } catch (error) {
      errors.push(`${reward.id}: ${String(error)}`);
    }
  }

  await lock.release();

  return NextResponse.json({
    success: true,
    checked: rewards.length,
    deactivated,
    errors: errors.slice(0, 20),
  });
}
