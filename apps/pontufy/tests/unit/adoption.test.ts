import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shapeAdoption } from '../../src/domain/analytics/adoption';

// ═══════════════════════════════════════════════════════════════════════════
// Funil de adoção — a conta que o painel mostra
//
// O risco aqui não é query lenta, é número mentiroso: divisão por zero virando
// `Infinity`/`NaN` no JSON (que o React renderiza como "NaN%"), percentual sem
// arredondamento e mediana negativa de importação legada.
//
// `shapeAdoption` é pura de propósito — é a parte que dá para testar sem banco.
// ═══════════════════════════════════════════════════════════════════════════

const raw = (eligible: number, started: number, completers: number, completions: number) => ({
  eligible,
  started,
  completers,
  completions,
});

test('funil calcula participação sobre a base elegível', () => {
  const report = shapeAdoption(raw(200, 50, 20, 300), [], 3);

  assert.equal(report.stages.eligible, 200);
  assert.equal(report.stages.started, 50);
  assert.equal(report.stages.completers, 20);

  const [eligible, started, completers] = report.funnel;
  assert.equal(eligible.shareOfEligible, 100);
  assert.equal(started.shareOfEligible, 25);
  assert.equal(completers.shareOfEligible, 10);
});

test('percentual tem uma casa e não vira dízima no JSON', () => {
  const report = shapeAdoption(raw(3, 1, 0, 1), [], null);
  assert.equal(report.funnel[1].shareOfEligible, 33.3);
});

test('base vazia não produz NaN nem divisão por zero', () => {
  const report = shapeAdoption(raw(0, 0, 0, 0), [], null);

  for (const stage of report.funnel) {
    assert.ok(Number.isFinite(stage.shareOfEligible), `stage ${stage.key} não é finito`);
    assert.equal(stage.users, 0);
  }
  assert.equal(report.lessonsPerLearner, 0);
  assert.equal(report.medianDaysToFirstLesson, null);
});

test('aulas por aprendiz usa quem realmente começou', () => {
  // 300 conclusões entre 50 pessoas ≠ 300/200 da base inteira.
  const report = shapeAdoption(raw(200, 50, 20, 300), [], 0);
  assert.equal(report.lessonsPerLearner, 6.0);
});

test('mediana negativa (importação legada) é limitada a zero', () => {
  const report = shapeAdoption(raw(10, 5, 1, 12), [], -2.4);
  assert.equal(report.medianDaysToFirstLesson, 0);
});

test('mediana é arredondada a uma casa', () => {
  const report = shapeAdoption(raw(10, 5, 1, 12), [], 2.46);
  assert.equal(report.medianDaysToFirstLesson, 2.5);
});

test('departamentos são ordenados por tamanho e a taxa é por departamento', () => {
  // `BigInt(...)` em vez de literal `10n`: o alvo do tsconfig é anterior a
  // ES2020 e o literal não compila. O valor é o mesmo que o driver devolve.
  const report = shapeAdoption(
    raw(100, 40, 8, 120),
    [
      { department: 'Vendas', eligible: BigInt(10), started: BigInt(5) },
      { department: 'Engenharia', eligible: BigInt(40), started: BigInt(20) },
      { department: 'Sem departamento', eligible: BigInt(50), started: BigInt(15) },
    ],
    1,
  );

  assert.deepEqual(
    report.byDepartment.map((row) => row.department),
    ['Sem departamento', 'Engenharia', 'Vendas'],
  );
  assert.equal(report.byDepartment[0].startRate, 30);
  assert.equal(report.byDepartment[1].startRate, 50);
  assert.equal(report.byDepartment[2].startRate, 50);
});

test('departamento sem ninguém não divide por zero', () => {
  const report = shapeAdoption(
    raw(5, 1, 0, 1),
    [{ department: 'Vazio', eligible: BigInt(0), started: BigInt(0) }],
    0,
  );
  assert.equal(report.byDepartment[0].startRate, 0);
  assert.ok(Number.isFinite(report.byDepartment[0].startRate));
});

test('bigint vindo do COUNT é convertido para número', () => {
  const report = shapeAdoption(
    {
      eligible: BigInt(7),
      started: BigInt(3),
      completers: BigInt(1),
      completions: BigInt(9),
    },
    [{ department: 'RH', eligible: BigInt(7), started: BigInt(3) }],
    null,
  );

  assert.equal(report.stages.eligible, 7);
  assert.equal(report.byDepartment[0].eligible, 7);
  assert.equal(typeof report.stages.eligible, 'number');
});

test('o ponto cego é declarado no relatório', () => {
  const report = shapeAdoption(raw(10, 5, 1, 12), [], 1);
  assert.ok(report.blindSpot.length > 40);
  assert.match(report.blindSpot, /iniciada/i);
});
