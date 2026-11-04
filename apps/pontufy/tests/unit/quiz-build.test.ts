import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildQuizModules } from '../../src/schemas/quiz';

// ═══════════════════════════════════════════════════════════════════════════
// Regressão: geração de curso NÃO pode falhar por causa do quiz.
//
// Em produção, o wizard respondia "An error occurred in the Server Components
// render" ao gerar curso. Causa: a action chamava `quizModulesSchema.parse`
// direto; quiz vazio (ou questão inválida) fazia o parse lançar e derrubava a
// geração inteira — que já tinha funcionado e já tinha gastado crédito.
//
// Sintoma sem mensagem é o pior tipo de erro: o usuário vê falha, o log não
// mostra a causa e o crédito foi consumido.
// ═══════════════════════════════════════════════════════════════════════════

const questaoValida = {
  question: 'Qual é o prazo para comunicar um incidente?',
  options: ['24 horas', '7 dias', '30 dias'],
  correctIndex: 0,
};

test('quiz vazio devolve null, sem lançar', () => {
  const result = buildQuizModules([]);
  assert.equal(result.modules, null);
  assert.deepEqual(result.discarded, []);
});

test('quiz indefinido devolve null, sem lançar', () => {
  const result = buildQuizModules(undefined);
  assert.equal(result.modules, null);
});

test('questão válida gera módulo com opções normalizadas', () => {
  const result = buildQuizModules([questaoValida]);
  assert.ok(result.modules);
  assert.equal(result.modules?.length, 1);
  assert.deepEqual(result.modules?.[0].questions[0].options, [
    { text: '24 horas' },
    { text: '7 dias' },
    { text: '30 dias' },
  ]);
});

test('correctIndex fora do intervalo é descartado, não derruba o curso', () => {
  const result = buildQuizModules([
    { ...questaoValida, correctIndex: 9 },
    questaoValida,
  ]);

  assert.equal(result.modules?.[0].questions.length, 1, 'só a válida permanece');
  assert.equal(result.discarded.length, 1);
  assert.match(result.discarded[0], /correctIndex/);
});

test('questão com menos de 2 opções é descartada', () => {
  const result = buildQuizModules([{ question: 'Só uma?', options: ['única'], correctIndex: 0 }]);
  assert.equal(result.modules, null, 'sem questão válida, curso fica sem quiz');
  assert.equal(result.discarded.length, 1);
});

test('texto vazio é descartado', () => {
  const result = buildQuizModules([{ question: '', options: ['a', 'b'], correctIndex: 0 }]);
  assert.equal(result.modules, null);
  assert.equal(result.discarded.length, 1);
});

test('todas inválidas ainda devolve null (curso sem quiz, geração preservada)', () => {
  const result = buildQuizModules([
    { question: 'x', options: ['a'], correctIndex: 0 },
    { question: 'y', options: ['a', 'b'], correctIndex: 5 },
  ]);

  assert.equal(result.modules, null);
  assert.equal(result.discarded.length, 2);
});

test('nenhuma exceção é lançada em nenhum caso — essa é a garantia central', () => {
  const entradas = [
    undefined,
    [],
    [{ question: '', options: [], correctIndex: -1 }],
    [{ question: 'ok?', options: ['a', 'b'], correctIndex: 1 }],
  ];

  for (const entrada of entradas) {
    assert.doesNotThrow(() => buildQuizModules(entrada));
  }
});
