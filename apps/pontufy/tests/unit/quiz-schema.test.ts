import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseBattleQuestions,
  parseQuizModules,
  quizModulesSchema,
  battleQuestionsSchema,
} from '../../src/schemas/quiz';

// ═══════════════════════════════════════════════════════════════════════════
// A3 — contrato do JSON persistido
//
// Antes era `String` com `JSON.parse` em try/catch: qualquer coisa que fosse
// JSON passava, inclusive `correctIndex` fora do intervalo — a correção da
// prova acontecia sobre dado inválido e ninguém percebia.
// ═══════════════════════════════════════════════════════════════════════════

const moduloValido = {
  module: 'Avaliação',
  questions: [
    { question: 'Pergunta?', options: [{ text: 'A' }, { text: 'B' }], correctIndex: 1 },
  ],
};

test('quiz: aceita a forma persistida e normaliza opção em string', () => {
  const parsed = quizModulesSchema.parse([
    {
      module: 'Avaliação',
      questions: [
        { question: 'Pergunta?', options: ['A', 'B'], correctIndex: 0 },
      ],
    },
  ]);

  assert.deepEqual(parsed[0].questions[0].options, [{ text: 'A' }, { text: 'B' }]);
});

test('quiz: rejeita correctIndex fora do intervalo de options', () => {
  const invalido = [
    {
      module: 'Avaliação',
      questions: [
        { question: 'Pergunta?', options: [{ text: 'A' }, { text: 'B' }], correctIndex: 5 },
      ],
    },
  ];

  assert.equal(quizModulesSchema.safeParse(invalido).success, false);
});

test('quiz: leitura tolerante devolve [] para dado ausente ou corrompido', () => {
  assert.deepEqual(parseQuizModules(null), []);
  assert.deepEqual(parseQuizModules('texto qualquer'), []);
  assert.deepEqual(parseQuizModules({ nao: 'e array' }), []);
  assert.deepEqual(parseQuizModules([{ module: 'x' }]), []);
  assert.equal(parseQuizModules([moduloValido]).length, 1);
});

test('batalha: aceita o payload { questions: [...] }', () => {
  const parsed = battleQuestionsSchema.parse({
    questions: [
      { question: 'Pergunta?', options: [{ text: 'A' }, { text: 'B' }], correctIndex: 0 },
    ],
  });

  assert.equal(parsed.questions.length, 1);
  assert.equal(parseBattleQuestions({ questions: parsed.questions }).length, 1);
});

test('batalha: leitura tolerante nunca estoura', () => {
  assert.deepEqual(parseBattleQuestions(null), []);
  assert.deepEqual(parseBattleQuestions({}), []);
  assert.deepEqual(parseBattleQuestions({ questions: [] }), []);
  assert.deepEqual(
    parseBattleQuestions({ questions: [{ question: 'q', options: [{ text: 'A' }], correctIndex: 0 }] }),
    [],
  );
});
