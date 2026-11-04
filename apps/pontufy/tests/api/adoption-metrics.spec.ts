import { test, expect } from '@playwright/test';

import { loginAs } from '../helpers/auth';
import { prisma, USERS } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Funil de adoção no painel de analytics.
//
// O painel existente responde "quanto a empresa consumiu". O bloco de adoção
// responde "quanta gente da base chegou a usar" — a pergunta que decide
// renovação.
//
// Este spec confere o número contra o banco, não contra si mesmo: se a query
// contar errado (por exemplo, incluindo admin de RH na base elegível ou
// contando conclusões em vez de pessoas), o teste falha.
// ═══════════════════════════════════════════════════════════════════════════

const TENANT = 'tenant-alpha-001';

async function expectedFunnel() {
  const eligible = await prisma.user.count({
    where: { tenantId: TENANT, role: { not: 'admin_rh' } },
  });

  const startedRows = await prisma.lessonCompletion.findMany({
    where: { tenantId: TENANT },
    select: { userId: true },
    distinct: ['userId'],
  });

  return { eligible, started: startedRows.length };
}

test.describe('Adoção no painel do RH', () => {
  test('devolve o funil coerente com o banco', async ({ request }) => {
    await loginAs(request, USERS.alphaAdmin);

    const res = await request.get('/api/admin/analytics');
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json();
    expect(body.adoption, 'bloco de adoção ausente na resposta').toBeDefined();

    const { funnel, stages, blindSpot } = body.adoption;
    expect(Array.isArray(funnel)).toBe(true);
    expect(funnel.map((stage: { key: string }) => stage.key)).toEqual([
      'eligible',
      'started',
      'completers',
    ]);

    const expected = await expectedFunnel();
    expect(stages.eligible, 'base elegível deve excluir admin_rh').toBe(expected.eligible);
    expect(stages.started, 'começaram = usuários distintos com conclusão').toBe(expected.started);

    // O funil não pode crescer no meio: quem terminou um curso obviamente começou.
    expect(stages.started).toBeLessThanOrEqual(stages.eligible);
    expect(stages.completers).toBeLessThanOrEqual(stages.started);

    for (const stage of funnel) {
      expect(Number.isFinite(stage.shareOfEligible), `${stage.key} não é finito`).toBe(true);
      expect(stage.shareOfEligible).toBeGreaterThanOrEqual(0);
      expect(stage.shareOfEligible).toBeLessThanOrEqual(100);
    }

    expect(blindSpot).toMatch(/iniciada/i);
  });

  test('departamentos somam a base elegível', async ({ request }) => {
    await loginAs(request, USERS.alphaAdmin);

    const res = await request.get('/api/admin/analytics');
    const body = await res.json();

    const byDepartment: Array<{ eligible: number; started: number; startRate: number }> =
      body.adoption.byDepartment;

    const totalEligible = byDepartment.reduce((sum, row) => sum + row.eligible, 0);
    expect(totalEligible, 'soma dos departamentos deve fechar com o funil').toBe(
      body.adoption.stages.eligible,
    );

    for (const row of byDepartment) {
      expect(row.started).toBeLessThanOrEqual(row.eligible);
      expect(Number.isFinite(row.startRate)).toBe(true);
    }
  });

  test('métricas de ativação têm tipo estável (nunca NaN)', async ({ request }) => {
    await loginAs(request, USERS.alphaAdmin);

    const res = await request.get('/api/admin/analytics');
    const body = await res.json();

    expect(typeof body.adoption.lessonsPerLearner).toBe('number');
    expect(Number.isFinite(body.adoption.lessonsPerLearner)).toBe(true);

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
