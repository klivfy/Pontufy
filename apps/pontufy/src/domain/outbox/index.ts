import type { PrismaClient } from '@prisma/client';

import { getRawPrisma } from '@/infra/platform-db';
import { logger } from '@/infra/logger';

// ═══════════════════════════════════════════════════════════════════════════
// B3 — Outbox de eventos
//
// Problema que resolve: `sendEmail`, notificação e auditoria eram
// fire-and-forget. Se o provedor falhasse — ou a função serverless morresse no
// meio — o efeito não acontecia e ninguém sabia. Não havia retry nem registro
// de que algo deveria ter acontecido.
//
// Como funciona:
//   1. A ação grava o evento na MESMA transação do fato (`enqueue`).
//   2. O worker pega um lote com `FOR UPDATE SKIP LOCKED` (duas instâncias não
//      processam o mesmo evento), executa o handler e marca done/failed.
//   3. Falha reagenda com backoff exponencial até `MAX_ATTEMPTS`.
//
// O que este módulo NÃO faz: garantir ordem. Eventos do mesmo tipo podem ser
// processados fora de ordem — para e-mail e notificação isso é aceitável.
// ═══════════════════════════════════════════════════════════════════════════

export type OutboxTx = Pick<PrismaClient, 'outboxEvent'>;

export const MAX_ATTEMPTS = 5;

/** Backoff: 1min, 5min, 15min, 1h, 6h. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 360];

export function nextAttemptDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts - 1, 0), BACKOFF_MINUTES.length - 1);
  return BACKOFF_MINUTES[index] * 60 * 1000;
}

export interface OutboxEventInput {
  type: string;
  payload: Record<string, unknown>;
  tenantId?: string | null;
  /** Quando o evento deve ficar elegível (padrão: agora). */
  availableAt?: Date;
}

/** Grava o evento. Deve ser chamado DENTRO da transação do fato. */
export async function enqueueEvent(tx: OutboxTx, input: OutboxEventInput): Promise<string> {
  const event = await tx.outboxEvent.create({
    data: {
      type: input.type,
      payload: input.payload as object,
      tenantId: input.tenantId ?? null,
      availableAt: input.availableAt ?? new Date(),
    },
    select: { id: true },
  });

  return event.id;
}

export interface ClaimedEvent {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  tenantId: string | null;
}

/**
 * Reserva um lote para processamento.
 *
 * `FOR UPDATE SKIP LOCKED` é o que impede duas instâncias de pegarem o mesmo
 * evento: cada uma trava as suas linhas e as demais seguem em frente. Sem isso,
 * o worker duplicaria e-mail a cada execução concorrente.
 *
 * `type` limita a uma família de evento — permite worker dedicado por tipo e
 * isola o teste do ruído de e-mail gerado por outras suítes.
 */
export async function claimBatch(limit = 20, type?: string): Promise<ClaimedEvent[]> {
  const prisma = getRawPrisma();

  if (type) {
    return prisma.$queryRaw<ClaimedEvent[]>`
      UPDATE "OutboxEvent"
      SET "status" = 'processing', "attempts" = "attempts" + 1, "updatedAt" = NOW()
      WHERE "id" IN (
        SELECT "id" FROM "OutboxEvent"
        WHERE "status" = 'pending' AND "availableAt" <= (NOW() AT TIME ZONE 'UTC') AND "type" = ${type}
        ORDER BY "availableAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "type", "payload", "attempts", "tenantId"
    `;
  }

  return prisma.$queryRaw<ClaimedEvent[]>`
    UPDATE "OutboxEvent"
    SET "status" = 'processing', "attempts" = "attempts" + 1, "updatedAt" = NOW()
    WHERE "id" IN (
      SELECT "id" FROM "OutboxEvent"
      WHERE "status" = 'pending' AND "availableAt" <= (NOW() AT TIME ZONE 'UTC')
      ORDER BY "availableAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "type", "payload", "attempts", "tenantId"
  `;
}

export async function markDone(id: string): Promise<void> {
  await getRawPrisma().outboxEvent.update({
    where: { id },
    data: { status: 'done', lastError: null },
  });
}

/**
 * Registra a falha e reagenda (ou esgota).
 *
 * `attempts` já foi incrementado no claim, então a decisão usa o valor atual.
 */
export async function markFailed(id: string, attempts: number, error: string): Promise<void> {
  const exhausted = attempts >= MAX_ATTEMPTS;
  const delay = nextAttemptDelayMs(attempts);

  await getRawPrisma().outboxEvent.update({
    where: { id },
    data: {
      status: exhausted ? 'failed' : 'pending',
      availableAt: exhausted ? new Date() : new Date(Date.now() + delay),
      lastError: error.slice(0, 500),
    },
  });

  if (exhausted) {
    logger.error('Evento de outbox esgotou as tentativas', { eventId: id, attempts, error }, 'outbox');
  } else {
    logger.warn('Evento de outbox reagendado', { eventId: id, attempts, retryInMs: delay }, 'outbox');
  }
}

/**
 * Devolve à fila eventos presos em `processing`.
 *
 * Se o worker morrer no meio (timeout da função), o evento ficaria travado
 * para sempre. A varredura devolve o que passou do prazo.
 */
export async function requeueStale(olderThanMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

  const result = await getRawPrisma().outboxEvent.updateMany({
    where: { status: 'processing', updatedAt: { lt: cutoff } },
    data: { status: 'pending', availableAt: new Date() },
  });

  if (result.count > 0) {
    logger.warn('Eventos de outbox travados devolvidos à fila', { count: result.count }, 'outbox');
  }

  return result.count;
}

/** Contagem por status — usado pelo endpoint de saúde operacional. */
export async function outboxStats(): Promise<Record<string, number>> {
  const rows = await getRawPrisma().outboxEvent.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});
}
