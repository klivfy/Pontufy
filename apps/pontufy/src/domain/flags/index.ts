import { getTenantDb } from '@/backend/db';
import { logger } from '@/infra/logger';

// ═══════════════════════════════════════════════════════════════════════════
// C4 — Feature flags por tenant
//
// Para que serve: ligar uma mudança em um cliente antes dos demais, e desligar
// rápido se algo der errado — sem deploy.
//
// Como lê: `isEnabled(tenantId, key, fallback)`. A ausência de linha devolve
// `fallback` (padrão `false`), então o call site decide qual é o comportamento
// seguro quando a flag não existe. Isso evita que esquecer de cadastrar a flag
// mude o produto para todo mundo.
//
// Cache: 60 s por processo. O custo de uma query por requisição seria pior que
// a janela de inconsistência — quem liga/desliga aceita esperar até 1 minuto.
// `FEATURE_FLAGS_DISABLED=1` desliga o mecanismo por completo (kill switch),
// comportamento útil se a tabela virar fonte de incidente.
// ═══════════════════════════════════════════════════════════════════════════

export type FlagKey = string;

interface CacheEntry {
  /** Valor gravado no banco; `undefined` = flag inexistente. */
  stored: boolean | undefined;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(tenantId: string, key: FlagKey): string {
  return `${tenantId}:${key}`;
}

/** Normaliza a chave: minúsculas, sem espaço, `dominio.recurso`. */
export function normalizeFlagKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '.').slice(0, 80);
}

export function isFlagKeyValid(key: string): boolean {
  return /^[a-z0-9]+(\.[a-z0-9_-]+)+$/.test(key);
}

/**
 * A flag está ligada para este tenant?
 *
 * @param fallback valor quando não existe linha (padrão: desligada)
 */
export async function isEnabled(
  tenantId: string,
  key: FlagKey,
  fallback = false,
): Promise<boolean> {
  if (process.env.FEATURE_FLAGS_DISABLED === '1') return fallback;

  const normalized = normalizeFlagKey(key);
  const cached = cache.get(cacheKey(tenantId, normalized));
  // O padrão é aplicado AQUI, não no cache: a mesma flag pode ser lida com
  // padrões diferentes por call sites distintos.
  if (cached && cached.expiresAt > Date.now()) return cached.stored ?? fallback;

  try {
    const db = getTenantDb(tenantId);
    const flag = await db.featureFlag.findFirst({
      where: { key: normalized },
      select: { enabled: true },
    });

    const stored = flag?.enabled;
    cache.set(cacheKey(tenantId, normalized), { stored, expiresAt: Date.now() + CACHE_TTL_MS });
    return stored ?? fallback;
  } catch (error) {
    // Flag não pode derrubar requisição: devolve o padrão e registra.
    logger.warn('Falha ao consultar feature flag', { tenantId, key: normalized, error: String(error) }, 'flags');
    return fallback;
  }
}

/** Lê todas as flags do tenant (para a tela de administração). */
export async function listFlags(tenantId: string): Promise<Array<{ key: string; enabled: boolean }>> {
  const db = getTenantDb(tenantId);
  const rows = await db.featureFlag.findMany({
    orderBy: { key: 'asc' },
    select: { key: true, enabled: true },
  });
  return rows.map((row) => ({ key: row.key, enabled: row.enabled }));
}

/** Liga/desliga uma flag. Invalida o cache do processo imediatamente. */
export async function setFlag(tenantId: string, key: FlagKey, enabled: boolean): Promise<void> {
  const normalized = normalizeFlagKey(key);

  const db = getTenantDb(tenantId);
  await db.featureFlag.upsert({
    where: { tenantId_key: { tenantId, key: normalized } },
    create: { tenantId, key: normalized, enabled },
    update: { enabled },
  });

  cache.delete(cacheKey(tenantId, normalized));
}

/** Limpa o cache — usado por teste e após mudança em lote. */
export function clearFlagCache(): void {
  cache.clear();
}
