import { test, expect } from '@playwright/test';
import { prisma, SEED } from './helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Bootstrap mínimo do banco para a suíte de API.
//
// O `global-setup` roda `prisma/seed.ts` (dados de demonstração: cursos,
// recompensas, contas) e depois cria os fixtures de isolamento/execução de
// teste. Quando só o seed roda — porque o setup falhou antes dos fixtures, ou
// porque alguém executou só `db:seed` — a suíte inteira falha com 404 em
// cascata, escondendo o problema real.
//
// Este projeto roda ANTES de `api` e `e2e` (dependencies) e ABORTA com
// mensagem clara se algum pré-requisito estiver faltando.
// ═══════════════════════════════════════════════════════════════════════════

test('fixtures de teste presentes no banco', async () => {
  const missing: string[] = [];

  const beta = await prisma.tenant.findUnique({ where: { slug: 'beta-corp' }, select: { id: true } });
  if (!beta) missing.push('tenant beta-corp (fixtures do global-setup)');

  for (const email of [
    'admin@empresaalpha.com',
    'joao@empresaalpha.com',
    'vip@empresaalpha.com',
    'poor@empresaalpha.com',
    'race@empresaalpha.com',
    'admin@betacorp.com',
    'employee@betacorp.com',
  ]) {
    const user = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true } });
    if (!user) missing.push(`usuário ${email}`);
    else if (!user.passwordHash) missing.push(`senha do usuário ${email}`);
  }

  const alphaCourse = await prisma.course.findUnique({
    where: { id: 'course-isolation-alpha-001' },
    select: { id: true },
  });
  if (!alphaCourse) missing.push('curso de isolamento da Alpha');

  const lesson = await prisma.lesson.findUnique({
    where: { id: SEED.lessonLgpd1 },
    select: { id: true },
  });
  if (!lesson) missing.push('aula do seed (lessonLgpd1)');

  expect(
    missing,
    `Pré-requisitos ausentes no banco de teste:\n${missing.map((m) => `  - ${m}`).join('\n')}\n\n` +
      'Rode a suíte com o `global-setup` habilitado (aplica migrações, seed e fixtures).',
  ).toEqual([]);

  await prisma.$disconnect();
});
