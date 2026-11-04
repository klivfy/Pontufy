// ═══════════════════════════════════════════════════════════════════════════
// B4 — SLOs mínimos: latência e taxa de erro por rota crítica
//
// LIMITAÇÃO DECLARADA: as amostras vivem na memória do processo. Em serverless,
// cada instância tem o seu buffer e um cold start zera tudo. Isto NÃO é
// observabilidade de produção — é a primeira camada: permite ver, na própria
// instância, que a rota está lenta ou falhando, sem esperar por um APM.
//
// Para SLO de verdade é preciso agregar (Vercel Analytics, Sentry ou tabela de
// métricas com flush periódico) — registrado como próximo passo no plano.
// ═══════════════════════════════════════════════════════════════════════════

export interface RouteMetric {
  route: string;
  /** Amostras guardadas (buffer circular). */
  samples: number;
  errors: number;
  errorRate: number;
  p50: number;
  p95: number;
  max: number;
  lastAt: string;
}

interface Bucket {
  durations: number[];
  errors: number;
  total: number;
  lastAt: number;
}

/** Quantas amostras guardar por rota (memória limitada, precisão suficiente). */
const MAX_SAMPLES = 500;

const buckets = new Map<string, Bucket>();

function bucketFor(route: string): Bucket {
  let bucket = buckets.get(route);
  if (!bucket) {
    bucket = { durations: [], errors: 0, total: 0, lastAt: 0 };
    buckets.set(route, bucket);
  }
  return bucket;
}

/** Registra uma execução. `ok = false` conta como erro (5xx ou exceção). */
export function recordRouteMetric(route: string, durationMs: number, ok: boolean): void {
  const bucket = bucketFor(route);
  bucket.total += 1;
  bucket.lastAt = Date.now();
  if (!ok) bucket.errors += 1;

  bucket.durations.push(durationMs);
  if (bucket.durations.length > MAX_SAMPLES) {
    bucket.durations.shift();
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

/** Fotografia das rotas medidas nesta instância. */
export function metricsSnapshot(): RouteMetric[] {
  return [...buckets.entries()]
    .map(([route, bucket]) => {
      const sorted = [...bucket.durations].sort((a, b) => a - b);
      return {
        route,
        samples: bucket.total,
        errors: bucket.errors,
        errorRate: bucket.total === 0 ? 0 : Math.round((bucket.errors / bucket.total) * 1000) / 10,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
        lastAt: bucket.lastAt ? new Date(bucket.lastAt).toISOString() : new Date(0).toISOString(),
      };
    })
    .sort((a, b) => b.p95 - a.p95);
}

/**
 * Envolve um handler medindo latência e erro.
 *
 * Erro = exceção ou status ≥ 500. 4xx é comportamento esperado do cliente
 * (saldo insuficiente, validação) e não entra na taxa de erro do SLO.
 */
export function withRouteMetrics<T extends Response>(
  route: string,
  handler: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  return handler().then(
    (response) => {
      recordRouteMetric(route, Date.now() - startedAt, response.status < 500);
      return response;
    },
    (error) => {
      recordRouteMetric(route, Date.now() - startedAt, false);
      throw error;
    },
  );
}

/** Limpa o buffer — usado por teste, não em produção. */
export function resetMetrics(): void {
  buckets.clear();
}
