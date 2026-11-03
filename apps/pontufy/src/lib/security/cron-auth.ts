import { timingSafeEqual } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
// Autorização de cron jobs — FAIL-CLOSED e sem bypass.
//
// Histórico: as 4 rotas de /api/cron aceitavam `x-vercel-cron: 1` como
// autorização. O header é controlado pelo cliente, então qualquer pessoa na
// internet disparava `expire-points` (expira pontos de TODOS os tenants) e
// `sync-lomadee` (desativa catálogo) com um `curl` de duas linhas.
//
// Contrato atual:
//   • Exige `Authorization: Bearer ${CRON_SECRET}` — é o header que o Vercel
//     Cron envia nativamente quando CRON_SECRET está configurado.
//   • Sem CRON_SECRET (ou com valor trivial) responde 503: nunca 200.
//   • Comparação em tempo constante.
//   • Header legado `x-vercel-cron` é IGNORADO por completo.
// ═══════════════════════════════════════════════════════════════════════════

const MIN_CRON_SECRET_LENGTH = 16;

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function authorizeCronRequest(request: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET;

  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH) {
    return { ok: false, status: 503, error: 'CRON_NOT_CONFIGURED' };
  }

  const authorization = request.headers.get('authorization') ?? '';
  if (!constantTimeEqual(authorization, `Bearer ${secret}`)) {
    return { ok: false, status: 401, error: 'UNAUTHORIZED' };
  }

  return { ok: true };
}
