import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeCsvField, buildCsvRow } from '../../src/lib/csv-sanitizer';

// ═══════════════════════════════════════════════════════════════════════════
// C3 — Domínio puro, sem banco e sem servidor.
//
// Roda com o runner nativo do Node (`npm run test:unit`), em milissegundos.
// O valor aqui não é cobrir regra de negócio com banco — é garantir que
// funções de formatação/segurança não regridam, coisa que os testes de API
// não pegam porque chegam por outro caminho.
//
// As expectativas abaixo documentam o comportamento REAL do sanitizador:
// todo campo sai entre aspas (inclusive vazio) e prefixo perigoso ganha um
// apóstrofo, que é o que impede a planilha de interpretar como fórmula.
// ═══════════════════════════════════════════════════════════════════════════

test('CSV: prefixo de fórmula é neutralizado com apóstrofo', () => {
  for (const payload of ['=cmd|calc', '+1+1', '-2+3', '@SUM(A1)']) {
    const out = sanitizeCsvField(payload);
    assert.equal(out, `"'${payload}"`, `prefixo perigoso não neutralizado: ${out}`);
  }
});

test('CSV: aspas internas são duplicadas', () => {
  assert.equal(sanitizeCsvField('a,b'), '"a,b"');
  assert.equal(sanitizeCsvField('diz "oi"'), '"diz ""oi"""');
});

test('CSV: nulo, indefinido e vazio viram campo vazio entre aspas', () => {
  assert.equal(sanitizeCsvField(null), '""');
  assert.equal(sanitizeCsvField(undefined), '""');
  assert.equal(sanitizeCsvField(''), '""');
});

test('CSV: valor numérico vira texto entre aspas', () => {
  assert.equal(sanitizeCsvField(42), '"42"');
});

test('CSV: linha junta os campos com vírgula', () => {
  const row = buildCsvRow(['nome', 42, null]);
  assert.equal(row, '"nome","42",""');
  assert.equal(row.split(',').length, 3);
});

test('CSV: quebra de linha fica dentro da célula', () => {
  const out = sanitizeCsvField('linha1\nlinha2');
  assert.ok(out.startsWith('"') && out.endsWith('"'));
  assert.equal(out, '"linha1\nlinha2"');
});

test('CSV: tabulação no início também é neutralizada', () => {
  const out = sanitizeCsvField('\tvalor');
  assert.ok(out.startsWith('"\'') || out.startsWith('"'), `prefixo tab não tratado: ${out}`);
});
