import { test, expect } from '@playwright/test';
import { prisma, USERS, userIdByEmail } from '../helpers/db';
import { reconcilePointsBalances } from '../../src/domain/points/reconcile';

// ═══════════════════════════════════════════════════════════════════════════
// A4 — Reconciliação saldo × ledger
//
// O saldo é cache do ledger. Nada garante que continuem iguais depois de bugs,
// migrações manuais ou jobs interrompidos. O job COMPARA e REPORTA; nunca
// corrige — corrigir sozinho apaga a evidência da causa.
// ═══════════════════════════════════════════════════════════════════════════

async function restoreBalance(userId: string): Promise<void> {
  const sum = await prisma.pointsLedger.aggregate({
    where: { userId },
    _sum: { pointsAmount: true },
  });
  // Recalcula pela convenção: gain soma, loss subtrai.
  const gain = await prisma.pointsLedger.aggregate({
    where: { userId, type: 'gain' },
    _sum: { pointsAmount: true },
  });
  const loss = await prisma.pointsLedger.aggregate({
    where: { userId, type: 'loss' },
    _sum: { pointsAmount: true },
  });
  const balance = (gain._sum.pointsAmount ?? 0) - (loss._sum.pointsAmount ?? 0);
  await prisma.user.update({ where: { id: userId }, data: { pointsBalance: balance } });
  void sum;
}

test.describe('A4 — reconciliação de pontos', () => {
  test('saldo coerente com o ledger não gera divergência', async () => {
    const userId = await userIdByEmail(USERS.alphaVip);
    await restoreBalance(userId);

    const result = await reconcilePointsBalances();

    const mine = result.drift.find((d) => d.userId === userId);
    expect(mine, `usuário ${USERS.alphaVip} apareceu como divergente`).toBeUndefined();
    expect(result.usersChecked).toBeGreaterThan(0);
  });

  test('detecta divergência e informa o delta, sem corrigir', async () => {
    const userId = await userIdByEmail(USERS.alphaVip);
    await restoreBalance(userId);

    // Corrompe o saldo em +137 sem tocar no ledger (simula bug/migração).
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { pointsBalance: true },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { pointsBalance: before.pointsBalance + 137 },
    });

    const result = await reconcilePointsBalances();
    const mine = result.drift.find((d) => d.userId === userId);

    expect(mine, 'a divergência precisa ser detectada').toBeTruthy();
    expect(mine?.delta).toBe(137);

    // O job NÃO corrige: o saldo continua corrompido.
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { pointsBalance: true },
    });
    expect(after.pointsBalance).toBe(before.pointsBalance + 137);

    await restoreBalance(userId);
  });

  test('tolerância absorve pequenas divergências conhecidas', async () => {
    const userId = await userIdByEmail(USERS.alphaVip);
    await restoreBalance(userId);

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { pointsBalance: true },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { pointsBalance: before.pointsBalance + 3 },
    });

    const strict = await reconcilePointsBalances(0);
    const relaxed = await reconcilePointsBalances(5);

    expect(strict.drift.some((d) => d.userId === userId)).toBe(true);
    expect(relaxed.drift.some((d) => d.userId === userId)).toBe(false);

    await restoreBalance(userId);
  });
});
