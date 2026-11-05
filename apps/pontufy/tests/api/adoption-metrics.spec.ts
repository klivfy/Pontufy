import { test, expect } from '@playwright/test';

import { loginAs } from '../helpers/auth';
import { prisma, USERS } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Funil de adoção no painel de analytics.
//
// O painel existente responde "quanto a empresa consumiu". O bloco de adoção
// responde "quanta gente da base chegou a usar, e onde as pessoas param".
//
// Este spec confere o número contra o banco, não contra si mesmo: se a query
// contar errado (incluindo admin de RH na base elegível, contando conclusões em
// vez de pessoas, ou somando abertura de outro tenant), o teste falha.
// ═══════════════════════════════════════════════════════════════════════════

const TENANT = 'tenant-alpha-001';

/** Usuários da base elegível — admin_rh fica de fora de TODAS as contagens. */
async function eligibleUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { tenantId: TENANT, role: { not: 'admin_rh' } },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

async function expectedFunnel() {
  const ids = await eligibleUserIds();

  const [openedRows, completedRows] = await Promise.all([
    prisma.lessonStart.findMany({
      where: { tenantId: TENANT, userId: { in: ids } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.lessonCompletion.findMany({
      where: { tenantId: TENANT, userId: { in: ids } },
      select: { userId: true },
      distinct: ['userId'],
    }),
  ]);

  return { eligible: ids.length, opened: openedRows.length, completedOne: completedRows.length };
}

test.describe('Adoção no painel do RH', () => {
  test('admin_rh que conclui aula não entra no funil', async ({ request }) => {
    // O tenant de demonstração tem exatamente esse caso: as únicas conclusões
    // são do admin, que testava o player. Sem o filtro, o funil mostrava
    // "1 pessoa começou" numa base de 5 onde nenhum colaborador começou.
    const rawCompleted = await prisma.lessonCompletion.findMany({
      where: { tenantId: TENANT },
      select: { userId: true },
      distinct: ['userId'],
    });

    const eligibleIds = new Set(await eligibleUserIds());
    const eligibleCompleted = rawCompleted.filter((row) => eligibleIds.has(row.userId));

    await loginAs(request, USERS.alphaAdmin);
    const res = await request.get('/api/admin/analytics');
    const { adoption } = await res.json();

    expect(adoption.stages.completedOne, 'só colaborador elegível conta como aprendiz').toBe(
      eligibleCompleted.length,
    );

    if (rawCompleted.length > eligibleCompleted.length) {
      expect(
        adoption.stages.completedOne,
        'conclusão de admin precisa ser descartada, não somada',
      ).toBeLessThan(rawCompleted.length);
    }
  });

  test('funil tem quatro degraus coerentes com o banco', async ({ request }) => {
    await loginAs(request, USERS.alphaAdmin);

    const res = await request.get('/api/admin/analytics');
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json();
    expect(body.adoption, 'bloco de adoção ausente na resposta').toBeDefined();

    const { funnel, stages, blindSpot } = body.adoption;
    expect(Array.isArray(funnel)).toBe(true);
    expect(funnel.map((stage: { key: string }) => stage.key)).toEqual([
      'eligible',
      'opened',
      'completedOne',
      'completers',
    ]);

    const expected = await expectedFunnel();
    expect(stages.eligible, 'base elegível deve excluir admin_rh').toBe(expected.eligible);
    expect(stages.opened, 'abriram = usuários distintos em LessonStart').toBe(expected.opened);
    expect(stages.completedOne, 'concluíram = usuários distintos em LessonCompletion').toBe(
      expected.completedOne,
    );

    // O funil não pode crescer no meio.
    expect(stages.opened).toBeLessThanOrEqual(stages.eligible);
    expect(stages.completedOne).toBeLessThanOrEqual(stages.eligible);
    expect(stages.completers).toBeLessThanOrEqual(stages.completedOne);

    for (const stage of funnel) {
      expect(Number.isFinite(stage.shareOfEligible), `${stage.key} não é finito`).toBe(true);
      expect(stage.shareOfEligible).toBeGreaterThanOrEqual(0);
      expect(stage.shareOfEligible).toBeLessThanOrEqual(100);
    }

    expect(blindSpot).toMatch(/04\/11\/2026/);
  });

  test('abandono bate com a diferença entre abrir e concluir', async ({ request }) => {
    await loginAs(request, USERS.alphaAdmin);

    const res = await request.get('/api/admin/analytics');
    const { adoption } = await res.json();

    const expectedAbandoned = Math.max(0, adoption.stages.opened - adoption.stages.completedOne);
    expect(adoption.abandoned).toBe(expectedAbandoned);
    expect(adoption.abandonmentRate).toBeGreaterThanOrEqual(0);
    expect(adoption.abandonmentRate).toBeLessThanOrEqual(100);
  });

  test('departamentos somam a base elegível', async ({ request }) => {
    await loginAs(request, USERS.alphaAdmin);

    const res = await request.get('/api/admin/analytics');
    const body = await res.json();

    const byDepartment: Array<{ eligible: number; opened: number; openRate: number }> =
      body.adoption.byDepartment;

    const totalEligible = byDepartment.reduce((sum, row) => sum + row.eligible, 0);
    expect(totalEligible, 'soma dos departamentos deve fechar com o funil').toBe(
      body.adoption.stages.eligible,
    );

    for (const row of byDepartment) {
      expect(row.opened).toBeLessThanOrEqual(row.eligible);
      expect(Number.isFinite(row.openRate)).toBe(true);
    }
  });

  test('métricas de ativação têm tipo estável (nunca NaN)', async ({ request }) => {
    await loginAs(request, USERS.alphaAdmin);

    const res = await request.get('/api/admin/analytics');
    const body = await res.json();

    for (const key of ['lessonsPerLearner', 'opensPerLearner', 'abandonmentRate'] as const) {
      expect(typeof body.adoption[key]).toBe('number');
      expect(Number.isFinite(body.adoption[key]), `${key} não é finito`).toBe(true);
    }

    const median = body.adoption.medianDaysToFirstLesson;
    expect(median === null || typeof median === 'number').toBe(true);
    if (typeof median === 'number') {
      expect(Number.isFinite(median)).toBe(true);
      expect(median).toBeGreaterThanOrEqual(0);
    }
  });

  test('employee não acessa o painel (403)', async ({ request }) => {
    await loginAs(request, USERS.alphaEmployee);

    const res = await request.get('/api/admin/analytics');
    expect(res.status()).toBe(403);
  });
});
