import { test, expect } from '@playwright/test';

import { loginAs } from '../helpers/auth';
import { USERS } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Quiz dinâmico — contrato que precisa sobreviver a mudanças de UI.
//
// O quiz deixou de ser uma lista fixa: cada tentativa recebe um subconjunto do
// banco, sorteado a partir de uma semente, e a correção acontece no servidor,
// que RECOMPÕE o sorteio. Duas invariantes disso:
//
//   1. o GET nunca entrega gabarito (`correctIndex` / `explanation`);
//   2. o POST corrige sobre o sorteio — a nota não vem do cliente.
//
// Se (1) quebrar, o quiz vira consulta. Se (2) quebrar, o cliente escolhe a
// própria nota. Nenhum dos dois aparece em teste de unidade.
// ═══════════════════════════════════════════════════════════════════════════

/** Primeiro curso publicado que tenha banco de questões. */
async function courseWithQuiz(request: import('@playwright/test').APIRequestContext) {
  const response = await request.get('/api/courses?limit=50');
  expect(response.status()).toBe(200);
  const body = await response.json();
  const list = (body.data ?? body.courses ?? body) as Array<{ id: string }>;
  expect(Array.isArray(list)).toBe(true);

  // A listagem não traz o quiz (payload enxuto): confirma no detalhe.
  for (const item of list.slice(0, 12)) {
    const detail = await request.get(`/api/courses/${item.id}`);
    if (detail.status() !== 200) continue;
    const course = await detail.json();
    if (Array.isArray(course.quiz) && course.quiz.length > 0) {
      return { id: course.id as string, quiz: course.quiz as unknown[] };
    }
  }

  throw new Error('nenhum curso publicado com quiz no seed');
}

test.describe('quiz dinâmico', () => {
  test('GET sorteia sem revelar gabarito', async ({ request }) => {
    await loginAs(request, USERS.alphaEmployee);
    const course = await courseWithQuiz(request);

    const response = await request.get(`/api/courses/${course.id}/quiz?seed=teste-a`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(typeof body.seed).toBe('string');
    expect(Array.isArray(body.questions)).toBe(true);
    expect(body.questions.length).toBeGreaterThan(0);

    for (const question of body.questions) {
      expect(typeof question.id).toBe('string');
      expect(typeof question.question).toBe('string');
      expect(Array.isArray(question.options)).toBe(true);
      expect(question.correctIndex).toBeUndefined();
      expect(question.explanation).toBeUndefined();
    }
  });

  test('sementes diferentes mudam a ordem das questões', async ({ request }) => {
    await loginAs(request, USERS.alphaEmployee);
    const course = await courseWithQuiz(request);

    const a = await (await request.get(`/api/courses/${course.id}/quiz?seed=ordem-1`)).json();
    const b = await (await request.get(`/api/courses/${course.id}/quiz?seed=ordem-2`)).json();

    const idsA = a.questions.map((q: { id: string }) => q.id).join(',');
    const idsB = b.questions.map((q: { id: string }) => q.id).join(',');
    // Banco com uma questão só não tem o que reordenar.
    if (a.questions.length > 1) expect(idsA).not.toBe(idsB);
  });

  test('POST corrige sobre o sorteio do servidor e devolve revisão', async ({ request }) => {
    await loginAs(request, USERS.alphaEmployee);
    const course = await courseWithQuiz(request);

    const selection = await (await request.get(`/api/courses/${course.id}/quiz?seed=correcao`)).json();
    const answers = Object.fromEntries(
      selection.questions.map((question: { id: string }) => [question.id, 0]),
    );

    const response = await request.post(`/api/courses/${course.id}/quiz`, {
      data: { seed: selection.seed, answers },
    });
    expect(response.status()).toBe(200);

    const result = await response.json();
    expect(result.total).toBe(selection.questions.length);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(result.total);
    expect(typeof result.passed).toBe('boolean');
    expect(Array.isArray(result.perQuestion)).toBe(true);
    expect(result.perQuestion).toHaveLength(selection.questions.length);
  });

  test('questão fora do sorteio não entra na conta', async ({ request }) => {
    await loginAs(request, USERS.alphaEmployee);
    const course = await courseWithQuiz(request);

    const selection = await (await request.get(`/api/courses/${course.id}/quiz?seed=fora`)).json();
    const answers = Object.fromEntries(
      selection.questions.map((question: { id: string }) => [question.id, 0]),
    );
    answers['questao-que-nao-existe'] = 0;

    const result = await (
      await request.post(`/api/courses/${course.id}/quiz`, { data: { seed: selection.seed, answers } })
    ).json();

    expect(result.total).toBe(selection.questions.length);
  });

  test('exige autenticação', async ({ request }) => {
    const response = await request.get('/api/courses/qualquer/quiz?seed=x');
    expect([401, 403, 404]).toContain(response.status());
  });
});
