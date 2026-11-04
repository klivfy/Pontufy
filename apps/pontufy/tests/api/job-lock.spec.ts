import { test, expect } from '@playwright/test';
import { prisma } from '../helpers/db';
import { acquireJobLock } from '../../src/infra/job-lock';

// ═══════════════════════════════════════════════════════════════════════════
// V7 — Exclusão mútua de jobs
//
// Os 4 crons podiam rodar sobrepostos (retry da Vercel + agendado + manual) e
// processar o mesmo lote duas vezes. O lock é um claim por TTL em tabela,
// independente de conexão (advisory lock por sessão não funciona com pooler).
// ═══════════════════════════════════════════════════════════════════════════

const LOCK_NAME = 'test:job-lock-contract';

test.describe('V7 — JobLock', () => {
  test.beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM "JobLock" WHERE "name" = ${LOCK_NAME}`;
  });

  test.afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "JobLock" WHERE "name" = ${LOCK_NAME}`;
  });

  test('segunda execução não adquire o lock enquanto a primeira está ativa', async () => {
    const first = await acquireJobLock(LOCK_NAME, 1);
    expect(first.acquired).toBe(true);

    try {
      const second = await acquireJobLock(LOCK_NAME, 1);
      expect(second.acquired, 'duas execuções simultâneas não podem rodar o mesmo job').toBe(false);
    } finally {
      await first.release();
    }
  });

  test('liberar o lock permite a execução seguinte', async () => {
    const first = await acquireJobLock(LOCK_NAME, 1);
    expect(first.acquired).toBe(true);
    await first.release();

    const second = await acquireJobLock(LOCK_NAME, 1);
    expect(second.acquired).toBe(true);
    await second.release();
  });

  test('lock com TTL expirado pode ser retomado (processo morto não trava o job)', async () => {
    // Simula execução anterior que morreu: linha com expiresAt no passado.
    await prisma.$executeRaw`
      INSERT INTO "JobLock" ("name", "expiresAt", "updatedAt")
      VALUES (${LOCK_NAME}, ${new Date(Date.now() - 60_000)}, ${new Date()})
    `;

    const lock = await acquireJobLock(LOCK_NAME, 1);
    expect(lock.acquired, 'TTL expirado precisa liberar o job').toBe(true);
    await lock.release();
  });
});
