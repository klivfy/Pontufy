import { test, expect } from '@playwright/test';
import { prisma, USERS, userIdByEmail } from '../helpers/db';
import { creditPoints, debitPoints, asPointsTx, PointsError } from '../../src/domain/points';
import { consumeLots, lotExpiryDate } from '../../src/domain/points/lots';

// ═══════════════════════════════════════════════════════════════════════════
// A1 — Lotes de pontos
//
// O saldo é um número; sem lotes a expiração não sabia QUAL ganho vencer.
// O invariante testado aqui é o coração do item:
//
//   SUM(PointsLot.remaining) == User.pointsBalance
// ═══════════════════════════════════════════════════════════════════════════

const TENANT = 'tenant-alpha-001';

async function sumRemaining(userId: string): Promise<number> {
  const lots = await prisma.pointsLot.findMany({ where: { userId }, select: { remaining: true } });
  return lots.reduce((sum, lot) => sum + lot.remaining, 0);
}

async function balanceOf(userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { pointsBalance: true },
  });
  return user.pointsBalance;
}

async function resetUser(email: string): Promise<string> {
  const userId = await userIdByEmail(email);
  await prisma.user.update({ where: { id: userId }, data: { pointsBalance: 0 } });
  await prisma.pointsLedger.deleteMany({ where: { userId } });
  await prisma.pointsLot.deleteMany({ where: { userId } });
  return userId;
}

test.describe('A1 — lotes de pontos', () => {
  test('crédito cria lote com validade e mantém o invariante', async () => {
    const userId = await resetUser(USERS.alphaPoor);

    await prisma.$transaction(async (tx) => {
      await creditPoints(asPointsTx(tx), {
        userId,
        tenantId: TENANT,
        amount: 100,
        description: 'teste de crédito',
      });
    });

    const lots = await prisma.pointsLot.findMany({ where: { userId } });
    expect(lots).toHaveLength(1);
    expect(lots[0].amount).toBe(100);
    expect(lots[0].remaining).toBe(100);
    expect(lots[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await sumRemaining(userId)).toBe(await balanceOf(userId));
  });

  test('débito consome o lote que vence primeiro', async () => {
    const userId = await resetUser(USERS.alphaPoor);

    // Dois lotes com validades distintas: o antigo deve ser consumido antes.
    await prisma.pointsLot.createMany({
      data: [
        {
          userId,
          tenantId: TENANT,
          amount: 50,
          remaining: 50,
          expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        },
        {
          userId,
          tenantId: TENANT,
          amount: 80,
          remaining: 80,
          expiresAt: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
        },
      ],
    });
    await prisma.user.update({ where: { id: userId }, data: { pointsBalance: 130 } });

    await prisma.$transaction(async (tx) => {
      await debitPoints(asPointsTx(tx), {
        userId,
        tenantId: TENANT,
        amount: 70,
        description: 'teste de débito',
      });
    });

    const lots = await prisma.pointsLot.findMany({
      where: { userId },
      orderBy: { expiresAt: 'asc' },
    });
    expect(lots[0].remaining, 'lote mais próximo de vencer deve ser esvaziado primeiro').toBe(0);
    expect(lots[1].remaining).toBe(60);
    expect(await sumRemaining(userId)).toBe(await balanceOf(userId));
  });

  test('consumo nunca passa do que o lote tem', async () => {
    const userId = await resetUser(USERS.alphaPoor);

    await prisma.pointsLot.create({
      data: {
        userId,
        tenantId: TENANT,
        amount: 40,
        remaining: 40,
        expiresAt: lotExpiryDate(),
      },
    });

    const result = await prisma.$transaction(async (tx) =>
      consumeLots(asPointsTx(tx), { userId, tenantId: TENANT, amount: 100 }),
    );

    // Consome o que existe e sinaliza o que faltou — nunca deixa negativo.
    expect(result.consumed).toBe(40);
    expect(await sumRemaining(userId)).toBe(0);
    const lot = await prisma.pointsLot.findFirstOrThrow({ where: { userId } });
    expect(lot.remaining).toBeGreaterThanOrEqual(0);
  });

  test('lote vencido não paga resgate', async () => {
    const userId = await resetUser(USERS.alphaPoor);

    await prisma.pointsLot.create({
      data: {
        userId,
        tenantId: TENANT,
        amount: 100,
        remaining: 100,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // ontem
      },
    });

    const result = await prisma.$transaction(async (tx) =>
      consumeLots(asPointsTx(tx), { userId, tenantId: TENANT, amount: 50 }),
    );

    expect(result.consumed, 'lote vencido não pode ser consumido').toBe(0);
    expect(result.lots).toHaveLength(0);
  });

  test('saldo insuficiente não cria lote nem debita', async () => {
    const userId = await resetUser(USERS.alphaPoor);
    await prisma.user.update({ where: { id: userId }, data: { pointsBalance: 10 } });

    await expect(
      prisma.$transaction(async (tx) => {
        await debitPoints(asPointsTx(tx), {
          userId,
          tenantId: TENANT,
          amount: 999,
          description: 'deve falhar',
        });
      }),
    ).rejects.toBeInstanceOf(PointsError);

    expect(await balanceOf(userId)).toBe(10);
    expect(await prisma.pointsLot.count({ where: { userId } })).toBe(0);
  });
});
