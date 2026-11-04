import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { prisma, SEED, USERS, userIdByEmail } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Concorrência & anti-double-spend em /api/lessons/complete
//
// A garantia NÃO pode depender do lock distribuído: sem Redis o mutex vira
// no-op e a correção precisa vir do banco (UNIQUE(userId, lessonId) + o
// UPDATE condicional de saldo em `debit/creditPoints`).
//
// Por isso o teste valida o INVARIANTE (1 conclusão, 1 lançamento, saldo certo)
// em vez do status HTTP de cada perdedor — que varia entre 429 (lock) e
// 200/alreadyCompleted (idempotência pelo banco).
// ═══════════════════════════════════════════════════════════════════════════

const LESSON = SEED.lessonLgpd1;
const POINTS = 40;

test.describe('Concorrência /api/lessons/complete', () => {
  test('5 POSTs concorrentes → exatamente 1 crédito no ledger e 1 conclusão', async ({ request }) => {
    const userId = await userIdByEmail(USERS.race);
    await loginAs(request, USERS.race);

    // Estado limpo e determinístico para a corrida.
    await prisma.pointsLedger.deleteMany({ where: { userId } });
    await prisma.lessonCompletion.deleteMany({ where: { userId } });
    await prisma.user.update({ where: { id: userId }, data: { pointsBalance: 0 } });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request.post('/api/lessons/complete', { data: { lessonId: LESSON } }),
      ),
    );

    const statuses = responses.map((r) => r.status());

    // Nenhuma resposta pode ser erro de servidor: perdedor da corrida é
    // 429 (lock) ou 200 (já concluída), nunca 500.
    for (const status of statuses) {
      expect([200, 429], `Status inesperado na corrida: ${statuses.join(',')}`).toContain(status);
    }

    // Invariante no banco (fonte da verdade):
    expect(
      await prisma.pointsLedger.count({ where: { userId } }),
      `Double-spend: ${statuses.join(',')}`,
    ).toBe(1);
    expect(await prisma.lessonCompletion.count({ where: { userId, lessonId: LESSON } })).toBe(1);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.pointsBalance).toBe(POINTS);
  });

  test('repetição idempotente (não concorrente) → 200 já concluída, sem novo crédito', async ({ request }) => {
    const userId = await userIdByEmail(USERS.race);
    await loginAs(request, USERS.race);

    const ledgerBefore = await prisma.pointsLedger.count({ where: { userId } });

    const res = await request.post('/api/lessons/complete', { data: { lessonId: LESSON } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.alreadyCompleted).toBe(true);
    expect(body.newBalance).toBe(POINTS);

    expect(await prisma.pointsLedger.count({ where: { userId } })).toBe(ledgerBefore);
  });
});
