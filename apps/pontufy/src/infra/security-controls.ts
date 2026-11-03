import { getRedis, rateLimitCheck } from '@/infra/redis';
import { logger } from '@/infra/logger';

// ═══════════════════════════════════════════════════════════════════════════
// Controles de segurança com política explícita de indisponibilidade (V4)
//
// Histórico: rate limit, account lockout, revogação de sessão e quota de IA
// dependem do Upstash. Sem Redis — plano vencido, região fora, token rotacionado
// — `getRedis()` devolve `null` e cada chamador fazia `if (!redis) return allow`.
// O resultado era o pior possível: a aplicação parecia saudável e a proteção
// contra força bruta estava desligada, sem nenhum sinal.
//
// Política adotada (decisão D2):
//   • CAMINHOS DE AUTENTICAÇÃO → fail-closed. Sem Redis, respondem 503.
//   • USO NORMAL (aula, resgate, quiz) → segue funcionando: a integridade
//     desses fluxos já vive no banco (UPDATE condicional + constraints).
//
// `GET /api/health` expõe o estado para monitoração.
// ═══════════════════════════════════════════════════════════════════════════

export type SecurityControlState = 'available' | 'unavailable';

/** `false` quando não há cliente Redis configurado. */
export function securityInfraAvailable(): boolean {
  return Boolean(getRedis());
}

export function securityControlState(): SecurityControlState {
  return securityInfraAvailable() ? 'available' : 'unavailable';
}

export type RateLimitOutcome = 'allowed' | 'blocked' | 'unavailable';

/**
 * Rate limit por IP/endpoint. Diferente de `rateLimitCheck`, distingue
 * "estourou o limite" de "não há infra para contar" — o chamador decide.
 */
export async function enforceIpRateLimit(
  ip: string,
  endpoint: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<RateLimitOutcome> {
  if (!securityInfraAvailable()) {
    logger.error(
      'Controle de segurança indisponível: rate limit sem Redis.',
      { endpoint, policy: 'fail-closed' },
      'security',
    );
    return 'unavailable';
  }

  const result = await rateLimitCheck(`ratelimit:ip:${ip}:${endpoint}`, maxRequests, windowSeconds);
  return result.allowed ? 'allowed' : 'blocked';
}

/**
 * Resposta padrão dos caminhos de autenticação quando a infra de segurança
 * está fora. Não revela detalhe interno para o cliente; o detalhe vai no log.
 */
export function securityUnavailableBody(): { error: string; code: string } {
  return {
    error: 'Serviço de autenticação temporariamente indisponível. Tente novamente em instantes.',
    code: 'SECURITY_INFRA_UNAVAILABLE',
  };
}

/** Erro usado no fluxo NextAuth (não há Response a devolver ali). */
export class SecurityInfraUnavailableError extends Error {
  constructor() {
    super('SECURITY_INFRA_UNAVAILABLE');
    this.name = 'SecurityInfraUnavailableError';
  }
}

/**
 * Usado no `authorize()` do NextAuth: sem infra de segurança não se autentica.
 *
 * CUIDADO: o NextAuth captura qualquer exceção do `authorize()` e a converte
 * em `CredentialsSignin` — o motivo real (SECURITY_INFRA_UNAVAILABLE) se perde
 * e o operador entende "senha errada" quando o problema é infraestrutura.
 * Por isso o erro é logado aqui, em nível de erro, antes de propagar.
 */
export function assertSecurityInfraForLogin(): void {
  if (!securityInfraAvailable()) {
    logger.error(
      '[AUTH] Login recusado por INDISPONIBILIDADE DE INFRA (Redis), não por credencial: ' +
        'rate limit, lockout e revogação de sessão estão desligados. ' +
        'O cliente receberá uma mensagem genérica de credencial — a causa é esta linha.',
      { policy: 'fail-closed', redis: 'unavailable' },
      'security',
    );
    throw new SecurityInfraUnavailableError();
  }
}
