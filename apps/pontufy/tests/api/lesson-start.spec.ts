import { test, expect } from '@playwright/test';

import { loginAs } from '../helpers/auth';
import { prisma, FIXTURES, SEED, USERS } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// "Aula aberta" — o evento que fecha o funil
//
// O player só avisava o servidor ao CONCLUIR. Sem abertura registrada, o funil
// não distinguia "ninguém entrou" de "todo mundo entrou e desistiu".
//
// O que este spec protege:
//   • abrir a aula cria exatamente uma linha, e reabrir não cria outra
//     (idempotência por usuário+aula — sem isso a métrica inflaria a cada
//     navegação e "aberturas por pessoa" perderia sentido);
//   • aula de outro tenant não é registrável (telemetria não vaza escopo);
//   • sem sessão não há registro.
// ═══════════════════════════════════════════════════════════════════════════

const START_URL = '/api/lessons/start';

async function clearStarts(email: string, lessonId: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return;

  await prisma.lessonStart.deleteMany({ where: { userId: user.id, lessonId } });
}

async function startsFor(email: string, lessonId: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return [];

  return prisma.lessonStart.findMany({
    where: { userId: user.id, lessonId },
    select: { id: true, tenantId: true },
  });
}

test.describe('Aula aberta (LessonStart)', () => {
  const lessonId = SEED.lessonLgpd1;
  const email = USERS.alphaEmployee;

  test.beforeEach(async () => {
    await clearStarts(email, lessonId);
  });

  test.afterAll(async () => {
    await clearStarts(email, lessonId);
  });

  test('abrir a aula registra uma abertura e reabrir não duplica', async ({ request }) => {
    await loginAs(request, email);

    const first = await request.post(START_URL, { data: { lessonId } });
    expect(first.status(), await first.text()).toBe(200);

    const firstBody = await first.json();
    expect(firstBody.success).toBe(true);
    expect(firstBody.firstOpen, 'primeira abertura precisa ser sinalizada').toBe(true);

    const second = await request.post(START_URL, { data: { lessonId } });
    expect(second.status()).toBe(200);
    expect((await second.json()).firstOpen, 'reabrir não é abertura nova').toBe(false);

    const rows = await startsFor(email, lessonId);
    expect(rows.length, 'reabrir não pode criar linha nova').toBe(1);
    expect(rows[0].tenantId, 'registro precisa carregar o tenant do usuário').toBe(
      'tenant-alpha-001',
    );
  });

  test('lessonId ausente → 400', async ({ request }) => {
    await loginAs(request, email);

    const res = await request.post(START_URL, { data: {} });
    expect(res.status()).toBe(400);
  });

  test('aula de outro tenant → 404, sem gravar nada', async ({ request }) => {
    await loginAs(request, email);

    const res = await request.post(START_URL, { data: { lessonId: FIXTURES.lessonIsolationBeta } });
    expect(res.status()).toBe(404);

    const rows = await prisma.lessonStart.findMany({
      where: { lessonId: FIXTURES.lessonIsolationBeta, tenantId: 'tenant-alpha-001' },
    });
    expect(rows.length, 'abertura de aula alheia não pode ser gravada').toBe(0);
  });

  test('sem sessão → 401', async ({ request }) => {
    const res = await request.post(START_URL, { data: { lessonId } });
    expect(res.status()).toBe(401);
  });
});
