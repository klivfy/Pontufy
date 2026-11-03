import { randomUUID } from 'node:crypto';
import { getRedis } from '@/infra/redis';

// ═══════════════════════════════════════════════════════════════════════════
// Mutex distribuído com FENCING TOKEN e degradação segura.
//
// Histórico de dois bugs corrigidos aqui:
//
//  1. `releaseLock` apagava a chave sem conferir o DONO. Se o TTL expirasse no
//     meio da operação e outra requisição pegasse o lock, a primeira a terminar
//     apagava o lock da segunda — e uma terceira entrava junto.
//     Agora o release/extend usam compare-and-delete/compare-and-expire (Lua).
//
//  2. Sem Redis, `acquireLock` retornava `false`, e as rotas respondiam 429
//     para sempre: funcionário não conseguia concluir aula nem resgatar nada.
//     Como a correção do saldo passou a viver no UPDATE condicional do banco
//     (`debitPoints`), o lock é uma OTIMIZAÇÃO — não um requisito. Sem Redis
//     ele vira no-op e a operação segue.
// ═══════════════════════════════════════════════════════════════════════════

const KEY_PREFIX = 'mutex:';

const RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

const EXTEND_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("EXPIRE", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

export interface LockHandle {
  key: string;
  token: string;
  /** false quando o lock é no-op (Redis ausente). */
  distributed: boolean;
}

/**
 * Tenta adquirir o lock. Retorna `null` quando outra requisição está com ele.
 * Sem Redis, retorna um handle não-distribuído (a operação prossegue).
 */
export async function acquireLock(key: string, ttlSeconds = 10): Promise<LockHandle | null> {
  const redis = getRedis();

  if (!redis) {
    return { key, token: 'no-redis', distributed: false };
  }

  const token = `${process.pid}:${Date.now()}:${randomUUID()}`;

  try {
    const acquired = await redis.set(`${KEY_PREFIX}${key}`, token, { nx: true, ex: ttlSeconds });
    return acquired === 'OK' ? { key, token, distributed: true } : null;
  } catch {
    // Redis instável não pode derrubar a jornada do usuário.
    return { key, token: 'redis-unavailable', distributed: false };
  }
}

/** Libera o lock apenas se ainda formos os donos. */
export async function releaseLock(handle: LockHandle | null): Promise<void> {
  if (!handle || !handle.distributed) return;

  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.eval(RELEASE_SCRIPT, [`${KEY_PREFIX}${handle.key}`], [handle.token]);
  } catch {
    // Sem fallback de `del`: apagar às cegas é exatamente o bug que este
    // fencing token existe para evitar. Na pior hipótese o lock expira no TTL.
  }
}

/** Estende o TTL — apenas se ainda formos os donos. */
export async function extendLock(handle: LockHandle | null, additionalTtlSeconds = 10): Promise<boolean> {
  if (!handle || !handle.distributed) return false;

  const redis = getRedis();
  if (!redis) return false;

  try {
    const result = await redis.eval(
      EXTEND_SCRIPT,
      [`${KEY_PREFIX}${handle.key}`],
      [handle.token, String(additionalTtlSeconds)],
    );
    return Number(result) === 1;
  } catch {
    return false;
  }
}
