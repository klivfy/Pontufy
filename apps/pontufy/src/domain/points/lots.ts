import type { PrismaClient } from '@prisma/client';

import { logger } from '@/infra/logger';
import { getRawPrisma } from '@/infra/platform-db';
import { lotExpiryDate } from '@/domain/points/lot-policy';

// ═══════════════════════════════════════════════════════════════════════════
// A1 — Lotes de pontos
//
// Cada crédito (`gain`) gera um lote com validade. O consumo acontece por lote,
// do que vence primeiro para o que vence depois, e cada operação de consumo é
// um UPDATE CONDICIONAL (`remaining >= quantidade`): duas requisições
// concorrentes não conseguem consumir o mesmo ponto duas vezes.
//
// Invariante que este módulo existe para garantir:
//
//   SUM(PointsLot.remaining) == User.pointsBalance
//
// Verificado em produção pelo job de reconciliação (A4 estendido).
// ═══════════════════════════════════════════════════════════════════════════

/** Superfície transacional mínima — igual ao padrão de `domain/points`. */
export type LotsTx = Pick<PrismaClient, 'pointsLot' | 'pointsLedger' | 'user'>;

export { LOT_EXPIRY_MONTHS, lotExpiryDate } from '@/domain/points/lot-policy';

/**
 * Cria o lote correspondente a um crédito.
 *
 * `sourceLedgerId` é único: repetir a chamada para o mesmo lançamento não cria
 * um segundo lote (idempotência) — devolve o lote existente.
 */
export async function createLotForGain(
  tx: LotsTx,
  params: {
    userId: string;
    tenantId: string;
    amount: number;
    sourceLedgerId?: string;
    expiresAt?: Date;
  },
): Promise<{ id: string; remaining: number }> {
  if (params.amount <= 0) {
    return { id: '', remaining: 0 };
  }

  const data = {
    userId: params.userId,
    tenantId: params.tenantId,
    amount: params.amount,
    remaining: params.amount,
    expiresAt: params.expiresAt ?? lotExpiryDate(),
    sourceLedgerId: params.sourceLedgerId ?? null,
  };

  if (params.sourceLedgerId) {
    // `upsert` em `sourceLedgerId` único: idempotente sem precisar de SELECT.
    const lot = await tx.pointsLot.upsert({
      where: { sourceLedgerId: params.sourceLedgerId },
      create: data,
      update: {},
      select: { id: true, remaining: true },
    });
    return lot;
  }

  const lot = await tx.pointsLot.create({ data, select: { id: true, remaining: true } });
  return lot;
}

/**
 * Consome lotes na ordem de validade (FIFO por `expiresAt`).
 *
 * A transação que chama esta função já debitou o saldo de forma atômica; aqui
 * a preocupação é que a soma dos `remaining` acompanhe o saldo.
 *
 * @returns quanto foi realmente consumido e os lotes tocados.
 */
export async function consumeLots(
  tx: LotsTx,
  params: { userId: string; tenantId: string; amount: number },
): Promise<{ consumed: number; lots: Array<{ id: string; taken: number }> }> {
  let pending = params.amount;
  const lots: Array<{ id: string; taken: number }> = [];

  if (pending <= 0) return { consumed: 0, lots };

  // Só lotes com saldo e ainda válidos: expirado não pode pagar resgate.
  const candidates = await tx.pointsLot.findMany({
    where: {
      userId: params.userId,
      tenantId: params.tenantId,
      remaining: { gt: 0 },
      expiresAt: { gt: new Date() },
    },
    orderBy: { expiresAt: 'asc' },
    select: { id: true, remaining: true },
  });

  for (const lot of candidates) {
    if (pending === 0) break;

    const take = Math.min(lot.remaining, pending);
    // Condicional: se outra transação consumiu este lote primeiro, `count` é 0
    // e seguimos para o próximo — nunca deixamos `remaining` negativo.
    const updated = await tx.pointsLot.updateMany({
      where: { id: lot.id, remaining: { gte: take } },
      data: { remaining: { decrement: take } },
    });

    if (updated.count === 1) {
      pending -= take;
      lots.push({ id: lot.id, taken: take });
    }
  }

  if (pending > 0) {
    // Invariante quebrado (saldo > soma dos lotes). Registra e não estoura a
    // operação: o débito já aconteceu e o resgate não pode ser desfeito aqui.
    logger.error('Consumo de lotes não cobriu o valor debitado', {
      userId: params.userId,
      tenantId: params.tenantId,
      requested: params.amount,
      missing: pending,
    }, 'points');
  }

  return { consumed: params.amount - pending, lots };
}

/**
 * Lotes vencidos com saldo — insumo do job de expiração.
 *
 * `take` limita o lote de trabalho (a execução seguinte pega o resto).
 */
export async function findExpirableLots(limit: number) {
  // O job roda sobre TODOS os tenants: não há sessão de tenant, então usa o
  // client de plataforma (única porta autorizada a fazer isso).
  return getRawPrisma().pointsLot.findMany({
    where: { remaining: { gt: 0 }, expiresAt: { lte: new Date() } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    select: { id: true, userId: true, tenantId: true, remaining: true, expiresAt: true },
  });
}
