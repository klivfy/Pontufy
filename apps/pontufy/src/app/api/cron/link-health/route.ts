import { NextRequest, NextResponse } from 'next/server';
import { getRawPrisma } from '@/infra/db';
import { logger } from '@/infra/logger';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const vercelCronHeader = request.headers.get('x-vercel-cron');
  const isVercelCron = vercelCronHeader === '1';
  const cronSecret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (!isAuthorized) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
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

  return NextResponse.json({
    success: true,
    checked: rewards.length,
    deactivated,
    errors: errors.slice(0, 20),
  });
}
