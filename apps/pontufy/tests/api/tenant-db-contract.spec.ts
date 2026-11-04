import { test, expect } from '@playwright/test';
import { prisma, SEED, USERS } from '../helpers/db';
import { getTenantDb } from '../../src/infra/db';

// ═══════════════════════════════════════════════════════════════════════════
// V2 — Contrato do interceptor multi-tenant
//
// Complementa `tenant-isolation.spec.ts` (que testa pela borda HTTP) atacando
// o interceptor diretamente. Os casos cobrem exatamente os buracos que a
// auditoria estrutural encontrou:
//   • leitura cruzada por id (findFirst/findUnique);
//   • `upsert` fora das listas READ_OPS/WRITE_OPS (passava sem escopo);
//   • `create` com tenantId estrangeiro no corpo;
//   • `Reward` híbrido: global visível, de outro tenant invisível.
//
// Regra: se um destes testes falhar, existe vazamento — não é flakiness.
// ═══════════════════════════════════════════════════════════════════════════

const ALPHA = SEED.tenantAlphaId;

async function betaTenantId(): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'beta-corp' }, select: { id: true } });
  if (!tenant) throw new Error('Tenant Beta ausente — rode o global-setup.');
  return tenant.id;
}

test.describe('V2 — getTenantDb não atravessa tenant', () => {
  test('findMany não devolve registros de outro tenant', async () => {
    const beta = await betaTenantId();
    const db = getTenantDb(ALPHA);

    const users = await db.user.findMany({ where: { tenantId: beta }, select: { id: true } });

    expect(users, 'filtro explícito por outro tenant deve continuar escopado no próprio').toEqual([]);
  });

  test('findUnique/findFirst por id de outro tenant retorna null', async () => {
    const betaUser = await prisma.user.findUnique({
      where: { email: USERS.betaEmployee },
      select: { id: true },
    });
    expect(betaUser, 'usuário de fixture do Beta ausente').not.toBeNull();

    const db = getTenantDb(ALPHA);
    const found = await db.user.findFirst({ where: { id: betaUser!.id }, select: { id: true } });

    expect(found).toBeNull();
  });

  test('create força o tenant do interceptor, ignorando tenantId estrangeiro no data', async () => {
    const beta = await betaTenantId();
    const email = `contrato-force-${Date.now()}@example.com`;
    const db = getTenantDb(ALPHA);

    try {
      const created = await db.user.create({
        data: {
          tenantId: beta, // tentativa de plantar usuário no tenant alheio
          name: 'Contrato Force',
          email,
        },
        select: { id: true, tenantId: true },
      });

      expect(created.tenantId, 'o interceptor deve sobrescrever o tenantId').toBe(ALPHA);

      const raw = await prisma.user.findUnique({ where: { id: created.id }, select: { tenantId: true } });
      expect(raw?.tenantId).toBe(ALPHA);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test('upsert não sequestra usuário de outro tenant (colide na unicidade de e-mail)', async () => {
    const before = await prisma.user.findUnique({
      where: { email: USERS.betaEmployee },
      select: { id: true, name: true },
    });
    expect(before).not.toBeNull();

    const db = getTenantDb(ALPHA);

    // `upsert` não estava em READ_OPS/WRITE_OPS: sem escopo, encontraria o
    // usuário do Beta e o MUTARIA. Com escopo, não encontra — e o create
    // resultante colide no e-mail único global.
    await expect(
      db.user.upsert({
        where: { email: USERS.betaEmployee },
        update: { name: 'SEQUESTRADO' },
        create: { tenantId: ALPHA, name: 'Invasor', email: USERS.betaEmployee },
      }),
    ).rejects.toThrow();

    const after = await prisma.user.findUnique({
      where: { email: USERS.betaEmployee },
      select: { name: true },
    });
    expect(after?.name, 'nome do usuário do Beta não pode ter sido alterado').toBe(before!.name);
  });

  test('Reward: global é visível, recompensa de outro tenant não é', async () => {
    const beta = await betaTenantId();
    const rewardId = `contract-reward-beta-${Date.now()}`;
    const globalRewardId = `contract-reward-global-${Date.now()}`;

    await prisma.reward.create({
      data: {
        id: rewardId,
        tenantId: beta,
        partner: 'LOMADEE',
        title: 'Recompensa do Beta',
        originalUrl: 'https://www.amazon.com.br/x',
        pricePoints: 100,
        isActive: true,
      },
    });
    await prisma.reward.create({
      data: {
        id: globalRewardId,
        tenantId: null,
        partner: 'LOMADEE',
        title: 'Recompensa global',
        originalUrl: 'https://www.amazon.com.br/y',
        pricePoints: 100,
        isActive: true,
      },
    });

    try {
      const db = getTenantDb(ALPHA);

      const foreign = await db.reward.findFirst({ where: { id: rewardId }, select: { id: true } });
      expect(foreign, 'recompensa de outro tenant não pode ser lida').toBeNull();

      const global = await db.reward.findFirst({ where: { id: globalRewardId }, select: { id: true } });
      expect(global?.id, 'recompensa global é visível para todos').toBe(globalRewardId);

      // Recompensa global é imutável a partir de um tenant.
      await expect(
        db.reward.update({ where: { id: globalRewardId }, data: { isActive: false } }),
      ).rejects.toThrow();
    } finally {
      await prisma.reward.deleteMany({ where: { id: { in: [rewardId, globalRewardId] } } });
    }
  });
});
