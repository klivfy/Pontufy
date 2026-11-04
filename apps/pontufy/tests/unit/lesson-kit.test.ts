import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveKitFromMarkdown,
  kitMetrics,
  normalizeKit,
  splitMarkdownSections,
  estimateSceneSeconds,
} from '../../src/domain/learning/lesson-kit';
import { readLessonKit } from '../../src/schemas/lesson-kit';

// ═══════════════════════════════════════════════════════════════════════════
// O kit é o que permite a mesma aula existir como vídeo, slide e leitura curta.
// Se a derivação quebrar, TODO curso legado perde os formatos novos — por isso
// ela é testada isoladamente, sem provedor de IA no meio.
// ═══════════════════════════════════════════════════════════════════════════

const AULA = `## Por que isso importa

A proteção de dados deixou de ser assunto só de TI. **Dado pessoal** é qualquer informação que identifica alguém, direta ou indiretamente.

- CPF, e-mail e telefone são dados pessoais
- Dado sensível exige cuidado redobrado
- A LGPD vale para qualquer empresa

## O que fazer na prática

Antes de compartilhar uma planilha, pergunte-se se ela precisa conter nome e CPF. Na dúvida, anonimize.

Use o canal oficial para enviar arquivos. Nunca use pendrive pessoal.

## Erros comuns

O erro mais comum é enviar a base completa quando bastava um recorte. Isso aumenta o risco sem necessidade.
`;

test('separa seções por cabeçalho', () => {
  const sections = splitMarkdownSections(AULA, 'Aula');
  assert.equal(sections.length, 3);
  assert.equal(sections[0].title, 'Por que isso importa');
  assert.ok(sections[1].body.includes('planilha'));
});

test('sem cabeçalho, agrupa parágrafos em vez de falhar', () => {
  const plain = 'Primeiro parágrafo com conteúdo real e suficiente.\n\nSegundo parágrafo, também com conteúdo.\n\nTerceiro.\n\nQuarto.';
  const sections = splitMarkdownSections(plain, 'Introdução');
  assert.ok(sections.length >= 1);
  assert.ok(sections[0].body.length > 10);
});

test('deriva slides, cenas e resumo do markdown', () => {
  const kit = deriveKitFromMarkdown(AULA, 'LGPD na prática');

  assert.equal(kit.slides.length, 3);
  assert.ok(kit.slides.every((s) => s.bullets.length >= 1));
  assert.equal(kit.video.scenes.length, 3);
  assert.ok(kit.video.scenes.every((s) => s.narration.length >= 20));
  assert.ok(kit.video.scenes.every((s) => s.seconds >= 6 && s.seconds <= 45));
  assert.ok(kit.plain.summary.length >= 40);
  assert.ok(kit.plain.bullets.length >= 2);
  // Sem IA não se inventa questão: o checkpoint fica vazio.
  assert.equal(kit.checkpoint.length, 0);
});

test('glossário sai dos termos em negrito', () => {
  const kit = deriveKitFromMarkdown(AULA, 'LGPD');
  const terms = (kit.plain.glossary ?? []).map((g) => g.term);
  assert.ok(terms.includes('Dado pessoal'));
});

test('markdown vazio não lança e devolve kit mínimo', () => {
  const kit = deriveKitFromMarkdown('', 'Aula vazia');
  assert.ok(kit.slides.length >= 1);
  // O contrato exige pelo menos 2 cenas: uma aula sem texto ganha abertura e
  // fechamento em vez de um roteiro de uma cena só.
  assert.ok(kit.video.scenes.length >= 2);
  assert.ok(kit.plain.summary.length >= 40);
  assert.ok(kit.plain.bullets.length >= 2);
  assert.ok(readLessonKit(kit) !== null);
});

test('estimativa de duração acompanha o tamanho da fala', () => {
  assert.equal(estimateSceneSeconds('curto'), 6);
  const long = Array.from({ length: 120 }, () => 'palavra').join(' ');
  assert.ok(estimateSceneSeconds(long) <= 45);
});

test('normalizeKit com lixo devolve a derivação, não erro', () => {
  const kit = normalizeKit({ video: 'nope' }, AULA, 'LGPD');
  assert.ok(kit.video.scenes.length >= 1);
  assert.ok(kit.slides.length >= 1);
});

test('normalizeKit completa campos ausentes com a derivação', () => {
  const parcial = {
    video: { title: 'Vídeo', scenes: [{ narration: 'Fala completa do instrutor nesta cena.', onScreen: 'Tela', visual: 'Imagem', seconds: 12 }] },
    slides: [],
    plain: { summary: 'Resumo curto escrito pelo modelo com frases simples e diretas sobre o tema.', bullets: ['Um'], glossary: [] },
    checkpoint: [],
  };
  const kit = normalizeKit(parcial, AULA, 'LGPD');
  // slides vazios -> vem da derivação
  assert.ok(kit.slides.length >= 1);
  // bullets insuficientes (1) -> completa com a derivação
  assert.ok(kit.plain.bullets.length >= 2);
});

test('normalizeKit descarta questão com correctIndex fora do intervalo', () => {
  const raw = {
    video: { title: 'V', scenes: [{ narration: 'Narração suficientemente longa para valer.', onScreen: 'T', visual: 'V', seconds: 10 }] },
    slides: [{ title: 'S', bullets: ['a'] }],
    plain: { summary: 'Resumo com frases curtas e palavras simples para medir a legibilidade do texto.', bullets: ['a', 'b'], glossary: [] },
    checkpoint: [
      { question: 'Pergunta inválida aqui?', options: ['a', 'b'], correctIndex: 5 },
      { question: 'Pergunta válida aqui?', options: ['a', 'b', 'c'], correctIndex: 1, difficulty: 'facil' },
    ],
  };
  const kit = normalizeKit(raw, AULA, 'LGPD');
  assert.equal(kit.checkpoint.length, 1);
  assert.equal(kit.checkpoint[0].correctIndex, 1);
});

test('métricas do kit são números utilizáveis no admin', () => {
  const kit = deriveKitFromMarkdown(AULA, 'LGPD');
  const m = kitMetrics(kit);
  assert.equal(m.slides, kit.slides.length);
  assert.ok(m.videoSeconds > 0);
  assert.ok(m.flesch >= 0 && m.flesch <= 100);
  assert.ok(m.words > 0 || m.readingMinutes >= 0);
});
