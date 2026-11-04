import { test, expect } from '@playwright/test';
import { prisma } from '../helpers/db';
import {
  claimBatch,
  enqueueEvent,
  markDone,
  markFailed,
  nextAttemptDelayMs,
  outboxStats,
  requeueStale,
  MAX_ATTEMPTS,
} from '../../src/domain/outbox';

// ═══════════════════════════════════════════════════════════════════════════
// B3 — Outbox
//
// Fire-and-forget perdia o efeito quando o provedor falhava. Aqui se testa o
// que faz o outbox valer: claim atômico, backoff, esgotamento e requeue de
// evento travado.
// ═══════════════════════════════════════════════════════════════════════════

const TYPE = 'test.outbox';

async function reset(): Promise<void> {
  await prisma.outboxEvent.deleteMany({ where: { type: TYPE } });
}

test.describe('B3 — outbox', () => {
  test.beforeEach(reset);
  test.afterAll(reset);

  test('grava o evento como pendente e elegível agora', async () => {
    await prisma.$transaction(async (tx) => {
      await enqueueEvent(tx, { type: TYPE, payload: { hello: 'world' } });
    });

    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { type: TYPE } });
    expect(event.status).toBe('pending');
    expect(event.attempts).toBe(0);
    expect(event.availableAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(event.payload).toEqual({ hello: 'world' });
  });

  test('claim marca processing, incrementa attempts e não repete o mesmo evento', async () => {
    await prisma.$transaction(async (tx) => {
      await enqueueEvent(tx, { type: TYPE, payload: { n: 1 } });
    });

    const first = await claimBatch(50, TYPE);
    const mine = first.filter((e) => e.type === TYPE);

    expect(mine).toHaveLength(1);
    expect(mine[0].attempts).toBe(1);

    // O evento já está `processing`: um segundo claim não o devolve.
    const second = await claimBatch(50, TYPE);
    expect(second.filter((e) => e.type === TYPE)).toHaveLength(0);
  });

  test('evento agendado para o futuro não é reivindicado', async () => {
    await prisma.$transaction(async (tx) => {
      await enqueueEvent(tx, {
        type: TYPE,
        payload: { n: 2 },
        availableAt: new Date(Date.now() + 60_000),
      });
    });

    const claimed = await claimBatch(50, TYPE);
    expect(claimed.filter((e) => e.type === TYPE)).toHaveLength(0);
  });

  test('markDone encerra o evento', async () => {
    await prisma.$transaction(async (tx) => {
      await enqueueEvent(tx, { type: TYPE, payload: {} });
    });
    const [event] = (await claimBatch(50, TYPE)).filter((e) => e.type === TYPE);

    await markDone(event.id);

    const stored = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.status).toBe('done');
    expect(stored.lastError).toBeNull();
  });

  test('falha reagenda com backoff e preserva o motivo', async () => {
    await prisma.$transaction(async (tx) => {
      await enqueueEvent(tx, { type: TYPE, payload: {} });
    });
    const [event] = (await claimBatch(50, TYPE)).filter((e) => e.type === TYPE);

    await markFailed(event.id, event.attempts, 'provedor fora do ar');

    const stored = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.status).toBe('pending');
    expect(stored.lastError).toContain('provedor fora do ar');
    expect(stored.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  test('esgotar as tentativas vira failed definitivo', async () => {
    await prisma.$transaction(async (tx) => {
      await enqueueEvent(tx, { type: TYPE, payload: {} });
    });
    const [event] = (await claimBatch(50, TYPE)).filter((e) => e.type === TYPE);

    await markFailed(event.id, MAX_ATTEMPTS, 'última tentativa');

    const stored = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.status).toBe('failed');
  });

  test('backoff cresce e tem teto', () => {
    const first = nextAttemptDelayMs(1);
    const second = nextAttemptDelayMs(2);
    const last = nextAttemptDelayMs(99);

    expect(first).toBe(60_000);
    expect(second).toBeGreaterThan(first);
    expect(last).toBe(360 * 60 * 1000);
  });

  test('requeueStale devolve evento travado em processing', async () => {
    const created = await prisma.outboxEvent.create({
      data: {
        type: TYPE,
        payload: {},
        status: 'processing',
        attempts: 1,
        updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const requeued = await requeueStale(15);

    expect(requeued).toBeGreaterThanOrEqual(1);
    const stored = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.status).toBe('pending');
  });

  test('stats conta por status', async () => {
    await prisma.outboxEvent.createMany({
      data: [
        { type: TYPE, payload: {}, status: 'pending' },
        { type: TYPE, payload: {}, status: 'failed' },
      ],
    });

    const stats = await outboxStats();
    expect(stats.pending).toBeGreaterThanOrEqual(1);
    expect(stats.failed).toBeGreaterThanOrEqual(1);
  });
});