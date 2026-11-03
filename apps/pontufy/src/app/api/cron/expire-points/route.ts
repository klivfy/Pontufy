import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/backend/db';
import { authorizeCronRequest } from '@/lib/security/cron-auth';
import { acquireJobLock } from '@/infra/job-lock';

const EXPIRY_MONTHS = 12;
// Teto por execução (V7). O job roda diariamente: o excedente fica para amanhã.
const MAX_LEDGER_ROWS = 5000;

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // V7 — execução única: cron sobreposto processaria o mesmo lote duas vezes.
  const lock = await acquireJobLock('cron:expire-points');
  if (!lock.acquired) {
    return NextResponse.json({ skipped: true, reason: 'locked' }, { status: 200 });
  }

  try {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - EXPIRY_MONTHS);

    // V7 — leitura limitada por lote. Sem o `take`, o job carregava TODO o
    // ledger elegível da plataforma na memória de um único serverless.
    // O restante é processado na próxima execução (o job é diário).
    const expirableGains = await prisma.pointsLedger.findMany({
      where: {
        type: 'gain',
        timestamp: { lt: cutoffDate },
      },
      select: {
        userId: true,
        tenantId: true,
        pointsAmount: true,
      },
      orderBy: { timestamp: 'asc' },
      take: MAX_LEDGER_ROWS,
    });
    const truncated = expirableGains.length === MAX_LEDGER_ROWS;

    if (expirableGains.length === 0) {
      return NextResponse.json({ success: true, expired: 0 });
    }

    const userTotals = new Map<string, { tenantId: string; total: number }>();
    for (const entry of expirableGains) {
      const existing = userTotals.get(entry.userId);
      if (existing) {
        existing.total += entry.pointsAmount;
      } else {
        userTotals.set(entry.userId, { tenantId: entry.tenantId, total: entry.pointsAmount });
      }
    }

    const alreadyExpired = await prisma.pointsLedger.findMany({
      where: {
        type: 'expiration',
        userId: { in: Array.from(userTotals.keys()) },
      },
      select: { userId: true, pointsAmount: true },
    });

    const expiredTotals = new Map<string, number>();
    for (const entry of alreadyExpired) {
      expiredTotals.set(entry.userId, (expiredTotals.get(entry.userId) || 0) + entry.pointsAmount);
    }

    let expiredCount = 0;

    for (const [userId, { tenantId, total }] of userTotals) {
      const alreadyExpiredAmount = expiredTotals.get(userId) || 0;
      const toExpire = total - alreadyExpiredAmount;

      if (toExpire <= 0) continue;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { pointsBalance: true },
      });

      if (!user) continue;

      const deduction = Math.min(toExpire, user.pointsBalance);
      if (deduction <= 0) continue;

      await prisma.$transaction([
        prisma.pointsLedger.create({
          data: {
            userId,
            tenantId,
            type: 'expiration',
            pointsAmount: deduction,
            description: `Expiração de ${deduction} pontos (acumulados há mais de ${EXPIRY_MONTHS} meses)`,
          },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { pointsBalance: { decrement: deduction } },
        }),
      ]);

      expiredCount++;
    }

    return NextResponse.json({
      success: true,
      usersProcessed: userTotals.size,
      usersExpired: expiredCount,
      truncated,
      nextRunHint: truncated ? 'Lote cheio: o restante será processado na próxima execução.' : undefined,
    });
  } catch (error) {
    console.error('CRON /api/cron/expire-points:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  } finally {
    await lock.release();
  }
}
