import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQuizSelection,
  difficultyMix,
  gradeSelection,
  readQuestionBank,
  selectQuestions,
  selectionCount,
  shuffle,
} from '../../src/domain/learning/quiz-selection';

// ═══════════════════════════════════════════════════════════════════════════
// Quiz dinâmico: cada tentativa vê um recorte diferente do banco.
//
// A propriedade que importa não é "sorteia" — é "sorteia a MESMA coisa para a
// mesma semente", porque o servidor precisa recompor a prova para corrigir sem
// confiar no cliente.
// ═══════════════════════════════════════════════════════════════════════════

function bank(size: number) {
  const levels = ['facil', 'medio', 'dificil'] as const;
  const questions = Array.from({ length: size }, (_, i) => ({
    question: `Pergunta ${i + 1} sobre o conteúdo?`,
    options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }],
    correctIndex: i % 3,
    id: `q${i + 1}`,
    difficulty: levels[i % 3],
    explanation: `Explicação da ${i + 1}`,
  }));
  return [{ module: 'Avaliação do Curso', questions }];
}

function buildSelection(json: unknown, seed: string, attempt = 1) {
  return buildQuizSelection(json, seed, attempt);
}

test('mesma semente, mesma prova', () => {
  const json = bank(20);
  const a = buildSelection(json, 'seed-abc');
  const b = buildSelection(json, 'seed-abc');
  assert.deepEqual(
    a.questions.map((q) => q.id),
    b.questions.map((q) => q.id),
  );
});

test('sementes diferentes produzem recortes diferentes', () => {
  const json = bank(24);
  const a = buildSelection(json, 'seed-a').questions.map((q) => q.id).join(',');
  const b = buildSelection(json, 'seed-b').questions.map((q) => q.id).join(',');
  assert.notEqual(a, b);
});

test('nunca devolve questão repetida', () => {
  const selected = buildSelection(bank(30), 'seed-x').questions;
  const ids = selected.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('banco pequeno vai inteiro', () => {
  const selected = buildSelection(bank(4), 'seed').questions;
  assert.equal(selected.length, 4);
});

test('banco grande é recortado, mas mantém tamanho mínimo', () => {
  assert.equal(selectionCount(30, 1), 12);
  assert.ok(selectionCount(10, 1) >= 5);
  assert.ok(selectionCount(10, 2) >= 5);
  assert.equal(selectionCount(3, 1), 3);
});

test('tentativa 2 alivia a dificuldade, tentativa 3 aperta', () => {
  assert.ok(difficultyMix(2).facil > difficultyMix(1).facil);
  assert.ok(difficultyMix(3).dificil > difficultyMix(1).dificil);
});

test('seleção respeita as cotas de dificuldade declaradas', () => {
  const selected = selectQuestions(readQuestionBank(bank(30)), 'seed-mix', 1);
  const counts = { facil: 0, medio: 0, dificil: 0 };
  for (const q of selected) if (q.difficulty) counts[q.difficulty]++;
  assert.ok(counts.facil >= 1);
  assert.ok(counts.medio >= 1);
  assert.ok(counts.dificil >= 1);
});

test('curso antigo sem dificuldade não quebra a seleção', () => {
  const legacy = [
    {
      module: 'Avaliação do Curso',
      questions: Array.from({ length: 10 }, (_, i) => ({
        question: `Pergunta antiga ${i + 1}?`,
        options: [{ text: 'A' }, { text: 'B' }],
        correctIndex: 0,
      })),
    },
  ];
  const selected = buildSelection(legacy, 'seed-legacy').questions;
  assert.ok(selected.length >= 5);
  assert.ok(selected.every((q) => q.id.length > 0));
});

test('JSON inválido vira seleção vazia, sem lançar', () => {
  assert.deepEqual(readQuestionBank('lixo'), []);
  assert.deepEqual(readQuestionBank(null), []);
  assert.equal(buildSelection(null, 'seed').questions.length, 0);
});

test('correção recompõe a prova no servidor e ignora respostas fora do sorteio', () => {
  const json = bank(12);
  const selection = buildSelection(json, 'seed-grade');
  const answers = Object.fromEntries(
    selection.questions.map((q) => {
      const full = readQuestionBank(json).find((b) => b.id === q.id)!;
      return [q.id, full.correctIndex];
    }),
  );
  // Injetar uma questão que NÃO está no sorteio não muda nada.
  answers['q999'] = 0;

  const result = gradeSelection(json, 'seed-grade', 1, answers);
  assert.equal(result.total, selection.questions.length);
  assert.equal(result.score, selection.questions.length);
  assert.equal(result.passed, true);
});

test('questão não respondida conta como erro', () => {
  const json = bank(6);
  const selection = buildSelection(json, 'seed-empty');
  const result = gradeSelection(json, 'seed-empty', 1, {});
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
  assert.equal(result.total, selection.questions.length);
});

test('embaralhar não perde itens', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const out = shuffle(items, () => 0.42);
  assert.equal(out.length, 20);
  assert.deepEqual([...out].sort((a, b) => a - b), items);
});
