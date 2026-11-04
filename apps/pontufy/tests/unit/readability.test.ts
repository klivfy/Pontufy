import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeReadability,
  countSyllables,
  levelFromFlesch,
  makePlainLanguage,
  simplifyToPlainLanguage,
  splitSentences,
  stripMarkdown,
} from '../../src/domain/learning/readability';

// ═══════════════════════════════════════════════════════════════════════════
// "Texto de fácil leitura" só é promessa cumprida se for medido.
//
// Estes testes travam a régua: se a fórmula ou a simplificação mudarem de
// comportamento, o número que a gente exibe no admin deixa de significar o que
// dizia. Sem isso, "Flesch 72" é decoração.
// ═══════════════════════════════════════════════════════════════════════════

test('conta sílabas por grupo de vogais', () => {
  assert.equal(countSyllables('a'), 1);
  assert.equal(countSyllables('dados'), 2); // da-dos
  assert.equal(countSyllables('segurança'), 4); // se-gu-ran-ça
  assert.equal(countSyllables('treinamento'), 4); // trei-na-men-to
  assert.equal(countSyllables('quinta'), 2); // quin-ta — o "u" não conta
  assert.equal(countSyllables('guitarra'), 3); // gui-tar-ra
  // Limite conhecido: hiato com "u" (gui-a) conta como um grupo. O erro é
  // sistemático e não muda a comparação entre textos.
  assert.equal(countSyllables('guia'), 1);
});

test('remove marcação antes de medir', () => {
  const md = '## Título\n\n- **Item** um\n- Item dois\n\nVeja [o link](https://x.com) e `código`.';
  const clean = stripMarkdown(md);
  assert.ok(!clean.includes('#'));
  assert.ok(!clean.includes('**'));
  assert.ok(!clean.includes('https://'));
  assert.ok(clean.includes('Título'));
});

test('divide frases e preserva abreviações', () => {
  const sentences = splitSentences('Use EPI etc. sempre. Depois confira o art. 12 da norma.');
  assert.equal(sentences.length, 2);
  assert.ok(sentences[0].includes('etc.'));
});

test('texto simples pontua acima da faixa "fácil"', () => {
  const simple =
    'Use o crachá todos os dias. Ele protege você e a equipe. ' +
    'Se perder, avise o RH na hora. O acesso é bloqueado em seguida.';
  const stats = analyzeReadability(simple);
  assert.ok(stats.flesch >= 60, `esperava >= 60, veio ${stats.flesch}`);
  assert.ok(['facil', 'muito-facil'].includes(stats.level));
  assert.ok(stats.avgWordsPerSentence < 12);
});

test('texto burocrático pontua como difícil', () => {
  const heavy =
    'Considerando a necessidade premente de estabelecimento de procedimentos ' +
    'padronizados relativamente à utilização de equipamentos de proteção individual, ' +
    'faz-se necessário que os colaboradores observem as disposições regulamentares ' +
    'atinentes à matéria, sob pena de responsabilização administrativa.';
  const stats = analyzeReadability(heavy);
  assert.ok(stats.flesch < 50, `esperava < 50, veio ${stats.flesch}`);
  assert.ok(['dificil', 'muito-dificil'].includes(stats.level));
});

test('simplificação encurta frase e troca jargão', () => {
  const input =
    'Com o objetivo de possibilitar a realização da conferência dos dados, ' +
    'é necessário que o colaborador realize a validação das informações previamente, ' +
    'posteriormente encaminhando o formulário ao gestor responsável.';
  const out = simplifyToPlainLanguage(input);
  assert.ok(!/com o objetivo de/i.test(out));
  assert.ok(!/posteriormente/i.test(out));
  assert.ok(!/realizar/i.test(out));
  assert.ok(out.endsWith('.') || out.endsWith('!') || out.endsWith('?'));
});

test('makePlainLanguage garante a métrica alvo ou o melhor esforço', () => {
  const input =
    'A implementação de metodologias ágeis pressupõe a adoção de cerimônias ' +
    'recorrentes, cuja finalidade precípua consiste na maximização da transparência ' +
    'relativamente ao progresso das entregas, possibilitando a identificação ' +
    'tempestiva de impedimentos que comprometam a consecução dos objetivos pactuados.';

  const result = makePlainLanguage(input, 60);
  assert.ok(result.attempts >= 1);
  assert.ok(result.text.length > 0);
  // O resultado nunca pode ser PIOR que a entrada original.
  const before = analyzeReadability(input).flesch;
  assert.ok(result.stats.flesch >= before, `piorou: ${before} -> ${result.stats.flesch}`);
});

test('faixas de nível são estáveis', () => {
  assert.equal(levelFromFlesch(90), 'muito-facil');
  assert.equal(levelFromFlesch(65), 'facil');
  assert.equal(levelFromFlesch(55), 'medio');
  assert.equal(levelFromFlesch(40), 'dificil');
  assert.equal(levelFromFlesch(20), 'muito-dificil');
});

test('texto vazio não quebra a análise', () => {
  const stats = analyzeReadability('');
  assert.equal(stats.words, 0);
  assert.equal(stats.flesch, 0);
});
