import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml } from '../../src/lib/html';
import { completeLessonSchema, redeemSchema } from '../../src/lib/validations';
// Importado do módulo PURO: lots.ts carrega o client de banco, e teste
// unitário não deve exigir DATABASE_URL.
import { lotExpiryDate, LOT_EXPIRY_MONTHS } from '../../src/domain/points/lot-policy';

// ═══════════════════════════════════════════════════════════════════════════
// C3 — funções puras: escape de e-mail, identificadores e validade de lote.
// ═══════════════════════════════════════════════════════════════════════════

test('escapeHtml neutraliza as cinco entidades perigosas', () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
  );
  assert.equal(escapeHtml("it's"), 'it&#39;s'); // forma real da implementação
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml preserva texto comum (sem duplo escape)', () => {
  assert.equal(escapeHtml('Treinamento de LGPD'), 'Treinamento de LGPD');
  assert.equal(escapeHtml('Ação & Reação'), 'Ação &amp; Reação');
});

test('identificador de aula aceita uuid e slug, rejeita o resto', () => {
  const ok = ['3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c', 'lesson-isolation-alpha-001', 'a_1'];
  for (const id of ok) {
    assert.equal(completeLessonSchema.safeParse({ lessonId: id }).success, true, `deveria aceitar ${id}`);
  }

  const bad = ['', 'a'.repeat(65), 'com espaço', 'com/barra', 'aspas"aqui', '<script>'];
  for (const id of bad) {
    assert.equal(completeLessonSchema.safeParse({ lessonId: id }).success, false, `deveria rejeitar ${id}`);
  }
});

test('resgate exige rewardId ou productUrl', () => {
  assert.equal(redeemSchema.safeParse({}).success, false);
  assert.equal(redeemSchema.safeParse({ rewardId: 'reward-001' }).success, true);
  assert.equal(redeemSchema.safeParse({ productUrl: 'https://loja.com/p/1' }).success, true);
});

test('validade do lote respeita a configuração de meses', () => {
  const from = new Date('2026-01-15T12:00:00.000Z');
  const expires = lotExpiryDate(from);

  const expected = new Date(from);
  expected.setMonth(expected.getMonth() + LOT_EXPIRY_MONTHS);
  assert.equal(expires.toISOString(), expected.toISOString());
  assert.ok(expires.getTime() > from.getTime());
});
