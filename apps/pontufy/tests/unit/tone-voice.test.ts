import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeTone, humanizeTone, refineTone } from '../../src/domain/learning/tone';
import {
  chunkNarration,
  describeVoice,
  pauseAfter,
  pickBestVoice,
  prosodyFor,
  rankVoices,
  scoreVoice,
  speechify,
} from '../../src/lib/voice';

// ═══════════════════════════════════════════════════════════════════════════
// Tom de voz e voz sintética.
//
// O problema que isto resolve é de produto, não de estética: treinamento
// obrigatório com texto de ofício e voz de leitor de tela faz o colaborador
// desligar. Os dois lados são testados aqui — a régua do texto e a escolha da
// voz — porque nenhum dos dois quebra com erro de compilação.
// ═══════════════════════════════════════════════════════════════════════════

const BUROCRATICO =
  'Prezado(a) colaborador(a), cumpre informar que faz-se necessário que os ' +
  'colaboradores deverão realizar a validação dos dados. ATENÇÃO: é VEDADO ' +
  'compartilhar a base sem autorização!!!';

const CORDIAL =
  'Olá! Vamos começar por uma pergunta simples: você sabe onde ficam os seus dados? ' +
  'Nesta aula, a gente vê como proteger as informações do time sem complicar o dia a dia. ' +
  'Conte comigo.';

test('texto de ofício pontua como burocrático', () => {
  const stats = analyzeTone(BUROCRATICO);
  assert.ok(stats.warmth < 35, `esperava < 35, veio ${stats.warmth}`);
  assert.equal(stats.level, 'burocratico');
  assert.ok(stats.formalityMarkers.length >= 2);
  assert.ok(stats.allCapsWords.length >= 1);
  assert.ok(stats.exclamations >= 3);
});

test('texto de conversa pontua como acolhedor', () => {
  const stats = analyzeTone(CORDIAL);
  assert.ok(stats.warmth >= 70, `esperava >= 70, veio ${stats.warmth}`);
  assert.ok(['acolhedor', 'neutro'].includes(stats.level));
  assert.equal(stats.addressesReader, true);
});

test('imperativo conta como falar com o leitor', () => {
  // "Envie só as colunas..." fala com o leitor sem usar a palavra "você".
  const imperativo = analyzeTone('Envie só as colunas que a outra área precisa. Evite anexar a base inteira.');
  assert.equal(imperativo.addressesReader, true);
  assert.ok(imperativo.warmth >= 55, `esperava >= 55, veio ${imperativo.warmth}`);
});

test('"é dado pessoal" não é lido como voz passiva', () => {
  const stats = analyzeTone('Dado pessoal é dado que identifica alguém. Você já viu isso antes.');
  assert.equal(stats.passiveCount, 0, 'falso positivo de passiva em "é dado"');
});

test('humanizeTone tira o jargão de ofício', () => {
  const out = humanizeTone(BUROCRATICO);
  assert.ok(!/prezad/i.test(out), 'sobrou "prezado"');
  assert.ok(!/cumpre informar/i.test(out), 'sobrou "cumpre informar"');
  assert.ok(!/faz-se necess/i.test(out), 'sobrou "faz-se necessário"');
  assert.ok(/você deve/i.test(out), 'não trocou para "você deve"');
});

test('humanizeTone desfaz grito mas preserva sigla', () => {
  const out = humanizeTone('ATENÇÃO: use o EPI e proteja o CPF na LGPD.');
  assert.ok(!/\bATENÇÃO\b/.test(out), 'caixa alta sobreviveu');
  assert.ok(out.includes('Atenção'));
  for (const acronym of ['EPI', 'CPF', 'LGPD']) {
    assert.ok(out.includes(acronym), `sigla ${acronym} foi alterada`);
  }
});

test('humanizeTone doma exclamação e travessão', () => {
  const out = humanizeTone('Cuidado!!! Isso é sério!!! — leia com atenção.');
  assert.ok(!/!!/.test(out));
  assert.ok(!out.includes('—'));
  assert.ok(out.includes(','));
});

test('refineTone melhora a nota do texto', () => {
  const { before, after, text } = refineTone(BUROCRATICO);
  assert.ok(after.warmth > before.warmth, `${before.warmth} -> ${after.warmth}`);
  assert.ok(text.length > 0);
});

test('escolhe voz neural em vez da padrão do sistema', () => {
  const voices = [
    { name: 'Microsoft Maria - Portuguese (Brazil)', lang: 'pt-BR', localService: true, default: true },
    { name: 'Microsoft Francisca Online (Natural) - Portuguese (Brazil)', lang: 'pt-BR', localService: false },
    { name: 'English United States', lang: 'en-US', localService: false },
  ];
  const best = pickBestVoice(voices);
  assert.ok(best?.name.includes('Francisca'), `escolheu ${best?.name}`);
});

test('voz sintética antiga é penalizada e idioma errado é descartado', () => {
  assert.ok(scoreVoice({ name: 'eSpeak Portuguese', lang: 'pt-BR' }).score < 0);
  assert.equal(scoreVoice({ name: 'English', lang: 'en-US' }).score, -1000);
  assert.equal(rankVoices([{ name: 'X', lang: 'en-US' }]).length, 0);
});

test('prosódia desacelera voz genérica e mantém a neural natural', () => {
  const neural = prosodyFor({ name: 'Microsoft Francisca Online (Natural)', lang: 'pt-BR' });
  const generica = prosodyFor({ name: 'Voz do sistema', lang: 'pt-BR' });
  assert.equal(neural.rate, 0.98);
  assert.ok(generica.rate < neural.rate, 'voz genérica deveria ler mais devagar');
  assert.ok(generica.pitch < 1, 'voz genérica deveria ter pitch menor');
});

test('speechify limpa markdown, emoji e exclamação', () => {
  const out = speechify('## Título\n\n- **Atenção** ao prazo de 24 horas! 😱\n\nAumento de 30% no risco.');
  assert.ok(!out.includes('#'));
  assert.ok(!out.includes('**'));
  assert.ok(!out.includes('!'));
  assert.ok(!/😱/.test(out));
  assert.ok(out.includes('30 por cento'));
});

test('chunkNarration respeita o teto e não corta palavra', () => {
  const texto =
    'Primeira frase curta. Segunda frase também curta, com uma vírgula no meio. ' +
    'Terceira frase que já é um pouco maior e serve para testar o agrupamento. '.repeat(2);
  const chunks = chunkNarration(texto, 120);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 140, `chunk grande demais: ${chunk.length}`);
    assert.ok(!chunk.startsWith(' '));
    // Nenhum chunk pode terminar no meio de uma palavra conhecida.
    assert.ok(!/\b(?:Segun|Tercei|Primei)$/.test(chunk));
  }
});

test('chunkNarration de texto vazio devolve lista vazia', () => {
  assert.deepEqual(chunkNarration(''), []);
  assert.deepEqual(chunkNarration('   '), []);
});

test('pausa é maior no fim de frase', () => {
  assert.ok(pauseAfter('Fim de frase.') > pauseAfter('meio da frase,'));
});

test('describeVoice diz se a voz é neural', () => {
  const neural = describeVoice([
    { name: 'Microsoft Antonio Online (Natural) - Portuguese (Brazil)', lang: 'pt-BR' },
  ]);
  assert.equal(neural.neural, true);

  const semVoz = describeVoice([]);
  assert.equal(semVoz.chosen, null);
  assert.equal(semVoz.neural, false);
});
