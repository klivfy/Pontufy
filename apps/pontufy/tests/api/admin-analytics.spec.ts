import { test, expect } from '@playwright/test';

import { loginAs } from '../helpers/auth';
import { USERS } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Regressão: /api/admin/analytics devolvia 500 e nenhum teste cobria isso.
//
// Dois defeitos somados, ambos só visíveis ao abrir o painel de RH:
//
// 1. O SQL somava por `lc."courseId"`, coluna que NÃO existe em
//    "LessonCompletion" (o curso vem de "Lesson"). Postgres: 42703.
// 2. Mesmo corrigindo (1), `COALESCE(c."status", 'removed')` quebrava depois
//    que `CourseStatus` virou enum no A2: o Postgres coage o COALESCE ao enum
//    e rejeita o literal 'removed'. Código 22P02.
//
// O teste fixa o contrato do endpoint — se o SQL voltar a referenciar coluna
// inexistente ou a misturar enum com texto livre, ele falha aqui, não no
// navegador do cliente.
// ═══════════════════════════════════════════════════════════════════════════

test.describe('analytics do RH', () => {
  test('devolve o resumo com 200 para admin_rh', async ({ request }) => {
    await loginAs(request, USERS.alphaAdmin);

    const response = await request.get('/api/admin/analytics');
    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body.summary).toBeDefined();
    expect(typeof body.summary.totalCourses).toBe('number');
    expect(Array.isArray(body.engagement)).toBe(true);
    expect(Array.isArray(body.topCourses)).toBe(true);
  });

  test('topCourses traz as colunas do contrato (id, title, status)', async ({ request }) => {
    await loginAs(request, USERS.alphaAdmin);

    const body = await (await request.get('/api/admin/analytics')).json();

    for (const course of body.topCourses) {
      expect(typeof course.id).toBe('string');
      expect(typeof course.title).toBe('string');
      // `status` vem de enum ou do literal 'removed' — nunca nulo.
      expect(typeof course.status).toBe('string');
      expect(typeof course.completions).toBe('number');
    }
  });

  test('colaborador comum recebe 403 (dado agregado é do RH)', async ({ request }) => {
    await loginAs(request, USERS.alphaEmployee);

    const response = await request.get('/api/admin/analytics');
    expect([401, 403]).toContain(response.status());
  });
});
