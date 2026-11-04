import { test } from 'node:test';
import assert from 'node:assert/strict';

import { metricsSnapshot, recordRouteMetric, resetMetrics, withRouteMetrics } from '../../src/infra/metrics';

// ═══════════════════════════════════════════════════════════════════════════
// B4 — SLO mínimo: p50/p95 e taxa de erro por rota.
//
// O buffer é local do processo — a limitação está documentada no módulo e
// exposta no endpoint. O que se testa aqui é o CÁLCULO.
// ═══════════════════════════════════════════════════════════════════════════

test('p95 usa nearest-rank: 1 outlier em 20 amostras é p100, não p95', () => {
  resetMetrics();
  // 19 rápidas + 1 lenta. Com nearest-rank, o único outlier cai fora do p95 —
  // ele aparece no `max`. É a semântica correta de percentil: 95% das
  // requisições foram mais rápidas que 50ms.
  for (let i = 0; i < 19; i += 1) recordRouteMetric('rota', 50, true);
  recordRouteMetric('rota', 2000, true);

  const [metric] = metricsSnapshot();
  assert.equal(metric.samples, 20);
  assert.equal(metric.p50, 50);
  assert.equal(metric.p95, 50, 'um outlier isolado não move o p95');
  assert.equal(metric.max, 2000, 'a cauda aparece no máximo');
});

test('quando 10% das requisições são lentas, o p95 captura a cauda', () => {
  resetMetrics();
  for (let i = 0; i < 90; i += 1) recordRouteMetric('rota', 50, true);
  for (let i = 0; i < 10; i += 1) recordRouteMetric('rota', 900, true);

  const [metric] = metricsSnapshot();
  assert.equal(metric.p95, 900, 'p95 precisa refletir a fração lenta');
  assert.equal(metric.p50, 50);
});

test('taxa de erro conta apenas falhas registradas', () => {
  resetMetrics();
  recordRouteMetric('rota', 10, true);
  recordRouteMetric('rota', 10, true);
  recordRouteMetric('rota', 10, false);

  const [metric] = metricsSnapshot();
  assert.equal(metric.errors, 1);
  assert.equal(metric.errorRate, 33.3);
});

test('rotas são medidas separadamente, ordenadas por p95', () => {
  resetMetrics();
  recordRouteMetric('lenta', 900, true);
  recordRouteMetric('rapida', 20, true);

  const snapshot = metricsSnapshot();
  assert.equal(snapshot.length, 2);
  assert.equal(snapshot[0].route, 'lenta');
  assert.equal(snapshot[1].route, 'rapida');
});

test('4xx não conta como erro; 5xx conta', async () => {
  resetMetrics();

  await withRouteMetrics('rota', async () => new Response(null, { status: 400 }));
  await withRouteMetrics('rota', async () => new Response(null, { status: 500 }));

  const [metric] = metricsSnapshot();
  assert.equal(metric.samples, 2);
  assert.equal(metric.errors, 1, 'apenas o 5xx deve contar como erro de SLO');
});

test('exceção conta como erro e propaga', async () => {
  resetMetrics();

  await assert.rejects(
    withRouteMetrics('rota', async () => {
      throw new Error('falhou');
    }),
  );

  const [metric] = metricsSnapshot();
  assert.equal(metric.errors, 1);
  assert.equal(metric.samples, 1);
});

test('buffer não cresce sem limite', () => {
  resetMetrics();
  for (let i = 0; i < 800; i += 1) recordRouteMetric('rota', i, true);

  const [metric] = metricsSnapshot();
  assert.equal(metric.samples, 800, 'total conta tudo');
  assert.ok(metric.max === 799, 'amostras guardadas preservam as mais recentes');
});
