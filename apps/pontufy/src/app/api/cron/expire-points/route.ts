import { NextResponse } from 'next/server';

import { findExpirableLots } from '@/domain/points/lots';
import { getRawPrisma } from '@/infra/platform-db';
import { logger } from '@/infra/logger';
import { authorizeCronRequest } from '@/lib/security/cron-auth';
import { acquireJobLock } from '@/infra/job-lock';

// ═══════════════════════════════════════════════════════════════════════════
// A1 — Expiração de pontos por LOTE
//
// A versão anterior era heurística: somava todos os ganhos antigos, subtraía o
// total já expirado e expirava a diferença por usuário. Isso pode expirar
// pontos de um ganho recente e deixar o antigo vivo — o dinheiro sai do lugar
// errado.
//
// Agora a expiração lê `PointsLot`, onde cada crédito tem validade e saldo
// próprio. Um lote vencido expira o que RESTA dele, e nada mais.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

/** Teto por execução: o excedente fica para a próxima rodada (job diário). */
const MAX_LOTS_PER_RUN = 2000;

export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const lock = await acquireJobLock('cron:expire-points');
  if (!lock.acquired) {
    return NextResponse.json({ skipped: true, reason: 'locked' }, { status: 200 });
  }

  try {
    const lots = await findExpirableLots(MAX_LOTS_PER_RUN);
    const truncated = lots.length === MAX_LOTS_PER_RUN;

    if (lots.length === 0) {
      return NextResponse.json({ success: true, lotsExpired: 0, pointsExpired: 0, usersAffected: 0 });
    }

    // Agrupa por usuário: uma transação por pessoa, não por lote.
    const byUser = new Map<string, { tenantId: string; lotIds: string[]; total: number }>();
    for (const lot of lots) {
      const entry = byUser.get(lot.userId);
      if (entry) {
        entry.lotIds.push(lot.id);
        entry.total += lot.remaining;
      } else {
        byUser.set(lot.userId, { tenantId: lot.tenantId, lotIds: [lot.id], total: lot.remaining });
      }
    }

    const prisma = getRawPrisma();
    let pointsExpired = 0;
    let lotsExpired = 0;
    let usersAffected = 0;

    for (const [userId, data] of byUser) {
      const result = await prisma.$transaction(async (tx) => {
        // O saldo pode estar menor que a soma dos lotes (divergência histórica).
        // Expira o que existe, nunca abaixo de zero — a constraint bloquearia.
        const user = await tx.user.findFirst({
          where: { id: userId, tenantId: data.tenantId },
          select: { pointsBalance: true },
        });
        if (!user) return { expired: 0, lots: 0 };

        const amount = Math.min(data.total, user.pointsBalance);

        if (amount > 0) {
          await tx.user.updateMany({
            where: { id: userId, tenantId: data.tenantId, pointsBalance: { gte: amount } },
            data: { pointsBalance: { decrement: amount } },
          });

          await tx.pointsLedger.create({
            data: {
              userId,
              tenantId: data.tenantId,
              type: 'expiration',
              pointsAmount: amount,
              description: `Expiração de ${data.lotIds.length} lote(s) vencido(s)`,
            },
          });
        }

        // Zera os lotes vencidos, independentemente de haver saldo a debitar:
        // o lote venceu, o valor não é mais utilizável.
        await tx.pointsLot.updateMany({
          where: { id: { in: data.lotIds } },
          data: { remaining: 0 },
        });

        return { expired: amount, lots: data.lotIds.length };
      });

      if (result.lots > 0) {
        usersAffected += 1;
        pointsExpired += result.expired;
        lotsExpired += result.lots;
      }
    }

    logger.info('Expiração por lote concluída', {
      lotsExpired,
      pointsExpired,
      usersAffected,
      truncated,
    }, 'points');

    return NextResponse.json({
      success: true,
      lotsExpired,
      pointsExpired,
      usersAffected,
      truncated,
    });
  } catch (error) {
    logger.error('Falha na expiração de pontos', { error: String(error) }, 'points');
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  } finally {
    await lock.release();
  }
}
