import { getRedis } from '@/infra/redis';

// ═══════════════════════════════════════════════════════════════════════════
// Pub/sub de notificações em tempo real (SSE) — POR USUÁRIO.
//
// Histórico: o canal era `sse:${tenantId}` (um por empresa) e o payload levava
// `message` e `link` de um usuário específico. Qualquer colaborador conectado
// recebia, em tempo real, o conteúdo das notificações dos colegas ("Você
// completou X e ganhou +N pontos", resultado de batalha citando o oponente,
// link de resgate). O filtro por `userId` era feito no cliente — o dado já
// havia saído do servidor.
//
// Agora cada usuário tem o próprio canal e o servidor nunca publica o evento
// de A no canal de B.
// ═══════════════════════════════════════════════════════════════════════════

/** Auto-limpeza da lista após 1h sem consumo. */
export const SSE_CHANNEL_TTL_SECONDS = 3600;

export function sseChannelKey(tenantId: string, userId: string): string {
  return `sse:${tenantId}:${userId}`;
}

/**
 * Publica um evento no canal do usuário. Fire-and-forget por design: falha de
 * Redis não pode derrubar a operação que gerou a notificação.
 */
export function publishToUser(tenantId: string, userId: string, event: string, data: unknown): void {
  const redis = getRedis();
  if (!redis) return;

  const key = sseChannelKey(tenantId, userId);

  redis
    .rpush(key, JSON.stringify({ type: event, data }))
    .then(() => redis.expire(key, SSE_CHANNEL_TTL_SECONDS))
    .catch(() => {});
}
