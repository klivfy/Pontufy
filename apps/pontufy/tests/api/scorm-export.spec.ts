import { test, expect } from '@playwright/test';

import { loginAs } from '../helpers/auth';
import { prisma, FIXTURES, SEED, USERS } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Export SCORM 1.2
//
// O que este spec protege:
//   • o download sai de verdade como ZIP (assinatura PK), não como JSON de erro
//     com status 200 — falha silenciosa clássica de rota que monta binário;
//   • o manifest viaja dentro do pacote com o schema certo;
//   • só admin_rh exporta (o pacote leva o curso para fora da plataforma);
//   • o export fica auditado.
// ═══════════════════════════════════════════════════════════════════════════

const COURSE_ID = SEED.courseLgpdId;
const SCORM_URL = `/api/admin/courses/${COURSE_ID}/scorm`;

test.describe('Export SCORM', () => {
  test('admin_rh baixa um ZIP válido com imsmanifest.xml dentro', async ({ request }) => {
    await loginAs(request, USERS.alphaAdmin);

    const res = await request.get(SCORM_URL);
    expect(res.status(), await res.text()).toBe(200);

    const headers = res.headers();
    expect(headers['content-type']).toBe('application/zip');
    expect(headers['content-disposition']).toContain('attachment;');
    expect(headers['content-disposition']).toContain('-scorm.zip');

    const body = await res.body();

    // Assinatura de arquivo ZIP: 50 4B 03 04.
    expect([...body.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(body.subarray(body.length - 22, body.length - 18).toString('hex')).toBe('504b0506');

    const text = body.toString('utf8');
    expect(text).toContain('imsmanifest.xml');
    expect(text).toContain('<schemaversion>1.2</schemaversion>');
    expect(text).toContain('adlcp:scormtype="sco"');
    expect(text).toContain('cmi.core.lesson_status');

    // Uma página por aula do curso do seed (3).
    const htmlPages = text.match(/scormcontent\/lesson-\d{2}\.html/g) ?? [];
    expect(new Set(htmlPages).size).toBeGreaterThanOrEqual(3);
  });

  test('export registra auditoria', async ({ request }) => {
    await loginAs(request, USERS.alphaAdmin);

    const before = await prisma.auditLog.count({
      where: { tenantId: 'tenant-alpha-001', action: 'COURSE_EXPORTED_SCORM' },
    });

    const res = await request.get(SCORM_URL);
    expect(res.status()).toBe(200);

    const after = await prisma.auditLog.count({
      where: { tenantId: 'tenant-alpha-001', action: 'COURSE_EXPORTED_SCORM' },
    });

    expect(after, 'export é saída de conteúdo e precisa de trilha').toBe(before + 1);
  });

  test('employee recebe 403', async ({ request }) => {
    await loginAs(request, USERS.alphaEmployee);

    const res = await request.get(SCORM_URL);
    expect(res.status()).toBe(403);
  });

  test('sem sessão → 401 (mesma semântica das outras rotas /api/admin)', async ({ request }) => {
    // /api/superadmin usa 403 opaco por decisão própria (não revelar a rota).
    // /api/admin distingue: sem sessão é 401, sessão sem papel é 403. O teste
    // fixa a distinção para ninguém "corrigir" uma das duas sem a outra.
    const res = await request.get(SCORM_URL);
    expect(res.status()).toBe(401);
  });

  test('curso inexistente → 404, nunca ZIP vazio', async ({ request }) => {
    await loginAs(request, USERS.alphaAdmin);

    const res = await request.get('/api/admin/courses/curso-que-nao-existe/scorm');
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toBe('Curso não encontrado.');
  });

  test('curso de outro tenant não é exportável', async ({ request }) => {
    // O curso beta existe no banco, mas o admin do alpha não pode vê-lo.
    await loginAs(request, USERS.alphaAdmin);

    const res = await request.get(`/api/admin/courses/${FIXTURES.courseIsolationBeta}/scorm`);
    expect(res.status()).toBe(404);
  });
});
