import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  shapeAdoption,
  type RawDepartmentRow,
  type RawFunnelRow,
} from '../../src/domain/analytics/adoption';

// ═══════════════════════════════════════════════════════════════════════════
// Funil de adoção — a conta que o painel mostra
//
// O risco aqui não é query lenta, é número mentiroso: divisão por zero virando
// `Infinity`/`NaN` no JSON (que o React renderiza como "NaN%"), percentual sem
// arredondamento, mediana negativa de importação legada e — desde que
// `LessonStart` entrou — abandono negativo quando há conclusão sem abertura
// registrada (dado legado).
//
// `shapeAdoption` é pura de propósito: é a parte que dá para testar sem banco.
// ═══════════════════════════════════════════════════════════════════════════

const raw = (
  eligible: number,
  opened: number,
  completedOne: number,
  completers: number,
  completions: number,
  opens: number,
): RawFunnelRow => ({
  eligible,
  opened,
  completed_one: completedOne,
  completers,
  completions,
  opens,
});

test('funil tem quatro degraus na ordem do percurso', () => {
  const report = shapeAdoption(raw(200, 120, 50, 20, 300, 260), [], 3);

  assert.deepEqual(
    report.funnel.map((stage) => stage.key),
    ['eligible', 'opened', 'completedOne', 'completers'],
  );
  assert.deepEqual(
    report.funnel.map((stage) => stage.users),
    [200, 120, 50, 20],
  );
});

test('participação é calculada sobre a base elegível', () => {
  const report = shapeAdoption(raw(200, 120, 50, 20, 300, 260), [], 3);

  assert.equal(report.funnel[0].shareOfEligible, 100);
  assert.equal(report.funnel[1].shareOfEligible, 60);
  assert.equal(report.funnel[2].shareOfEligible, 25);
  assert.equal(report.funnel[3].shareOfEligible, 10);
});

test('abandono é quem abriu e não concluiu nenhuma aula', () => {
  const report = shapeAdoption(raw(100, 40, 25, 4, 90, 120), [], 1);

  assert.equal(report.abandoned, 15);
  assert.equal(report.abandonmentRate, 37.5);
});

test('abandono nunca fica negativo (conclusão sem abertura é dado legado)', () => {
  // Série começou em 04/11: quem concluiu antes disso não tem LessonStart.
  const report = shapeAdoption(raw(50, 10, 30, 5, 80, 12), [], null);

  assert.equal(report.abandoned, 0);
  assert.equal(report.abandonmentRate, 0);
});

test('percentual tem uma casa e não vira dízima no JSON', () => {
  const report = shapeAdoption(raw(3, 1, 1, 0, 1, 1), [], null);
  assert.equal(report.funnel[1].shareOfEligible, 33.3);
});

test('base vazia não produz NaN nem divisão por zero', () => {
  const report = shapeAdoption(raw(0, 0, 0, 0, 0, 0), [], null);

  for (const stage of report.funnel) {
    assert.ok(Number.isFinite(stage.shareOfEligible), `stage ${stage.key} não é finito`);
    assert.equal(stage.users, 0);
  }
  assert.equal(report.lessonsPerLearner, 0);
  assert.equal(report.opensPerLearner, 0);
  assert.equal(report.abandonmentRate, 0);
  assert.equal(report.medianDaysToFirstLesson, null);
});

test('médias usam a base certa — não a empresa inteira', () => {
  const report = shapeAdoption(raw(200, 120, 50, 20, 300, 260), [], 0);

  // 260 aberturas de 120 pessoas, não de 200.
  assert.equal(report.opensPerLearner, 2.2);
  // 300 conclusões de 50 pessoas que concluíram, não de 200.
  assert.equal(report.lessonsPerLearner, 6.0);
});

test('mediana negativa (importação legada) é limitada a zero', () => {
  assert.equal(shapeAdoption(raw(10, 5, 5, 1, 12, 6), [], -2.4).medianDaysToFirstLesson, 0);
  assert.equal(shapeAdoption(raw(10, 5, 5, 1, 12, 6), [], 2.46).medianDaysToFirstLesson, 2.5);
});

test('departamentos trazem abertura e conclusão, ordenados por tamanho', () => {
  const departments: RawDepartmentRow[] = [
    { department: 'Vendas', eligible: BigInt(10), opened: BigInt(4), completed_one: BigInt(2) },
    { department: 'Engenharia', eligible: BigInt(40), opened: BigInt(20), completed_one: BigInt(10) },
    {
      department: 'Sem departamento',
      eligible: BigInt(50),
      opened: BigInt(5),
      completed_one: BigInt(1),
    },
  ];

  const report = shapeAdoption(raw(100, 29, 13, 3, 40, 35), departments, 1);

  assert.deepEqual(
    report.byDepartment.map((row) => row.department),
    ['Sem departamento', 'Engenharia', 'Vendas'],
  );
  assert.equal(report.byDepartment[0].openRate, 10);
  assert.equal(report.byDepartment[1].openRate, 50);
  assert.equal(report.byDepartment[1].completedOne, 10);
});

test('departamento sem ninguém não divide por zero', () => {
  const report = shapeAdoption(
    raw(5, 1, 1, 0, 1, 1),
    [{ department: 'Vazio', eligible: BigInt(0), opened: BigInt(0), completed_one: BigInt(0) }],
    0,
  );
  assert.equal(report.byDepartment[0].openRate, 0);
  assert.ok(Number.isFinite(report.byDepartment[0].openRate));
});

test('bigint vindo do COUNT é convertido para número', () => {
  const report = shapeAdoption(
    {
      eligible: BigInt(7),
      opened: BigInt(5),
      completed_one: BigInt(3),
      completers: BigInt(1),
      completions: BigInt(9),
      opens: BigInt(6),
    },
    [{ department: 'RH', eligible: BigInt(7), opened: BigInt(5), completed_one: BigInt(3) }],
    null,
  );

  assert.equal(report.stages.opened, 5);
  assert.equal(report.byDepartment[0].opened, 5);
  assert.equal(typeof report.stages.eligible, 'number');
});

test('início da série é declarado para número antigo não ser lido como regressão', () => {
  const since = '2026-11-04T14:00:00.000Z';
  const report = shapeAdoption(raw(10, 5, 1, 0, 2, 5), [], 1, since);

  assert.equal(report.measuredSince, since);
  assert.match(report.blindSpot, /04\/11\/2026/);
});
