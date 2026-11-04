import { NextResponse } from 'next/server';

import {
  claimBatch,
  MAX_ATTEMPTS,
  markDone,
  markFailed,
  outboxStats,
  requeueStale,
  type ClaimedEvent,
} from '@/domain/outbox';
import {
  isEmailDeliveryConfigured,
  sendEmailDirect,
  type EmailPayload,
} from '@/infra/email';
import { logger } from '@/infra/logger';
import { authorizeCronRequest } from '@/lib/security/cron-auth';
import { acquireJobLock } from '@/infra/job-lock';

// ═══════════════════════════════════════════════════════════════════════════
// B3 — Worker do outbox
//
// Executa os eventos pendentes nesta chamada (Vercel Cron ou disparo manual).
// O lock garante execução única; `FOR UPDATE SKIP LOCKED` no claim protege
// mesmo se duas instâncias rodarem ao mesmo tempo.
//
// Handler desconhecido NÃO é retentado: fica `failed` com motivo explícito,
// porque repetir não vai fazer o tipo existir.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 25;

interface Handler {
  /**
   * O handler depende de um provedor externo configurado. Sem ele o evento
   * NÃO deve ser reivindicado: consumir a tentativa marcaria como `failed`
   * um e-mail que nunca teve chance de sair.
   */
  requiresEmail: boolean;
  run: (payload: unknown) => Promise<void>;
}

const HANDLERS: Record<string, Handler> = {
  'email.send': {
    requiresEmail: true,
    run: async (payload) => {
      const email = payload as EmailPayload;
      const sent = await sendEmailDirect(email);
      if (!sent) throw new Error('provedor de e-mail recusou o envio');
    },
  },
};

async function runWorker(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const lock = await acquireJobLock('cron:outbox-worker', 5);
  if (!lock.acquired) {
    return NextResponse.json({ skipped: true, reason: 'locked' }, { status: 200 });
  }

  try {
    // Só reivindica tipo cujo handler está de pé. Evento sem provedor fica
    // `pending` — volta a fluir sozinho no primeiro tick depois que a chave é
    // configurada, em vez de esgotar as tentativas e virar `failed`.
    const ready = Object.entries(HANDLERS)
      .filter(([, handler]) => !handler.requiresEmail || isEmailDeliveryConfigured())
      .map(([type]) => type);

    if (ready.length === 0) {
      logger.warn(
        'Worker sem handler pronto — eventos permanecem pendentes',
        { reason: 'provedor de e-mail não configurado' },
        'outbox',
      );
      return NextResponse.json(
        { skipped: true, reason: 'provider_not_configured', ready },
        { status: 200 },
      );
    }

    const requeued = await requeueStale();

    const events: ClaimedEvent[] = [];
    for (const type of ready) {
      if (events.length >= BATCH_SIZE) break;
      const batch = await claimBatch(BATCH_SIZE - events.length, type);
      events.push(...batch);
    }

    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const event of events) {
      const handler = HANDLERS[event.type];

      if (!handler) {
        await markFailed(event.id, MAX_ATTEMPTS, `handler desconhecido: ${event.type}`);
        failed += 1;
        skipped += 1;
        continue;
      }

      try {
        await handler.run(event.payload);
        await markDone(event.id);
        processed += 1;
      } catch (error) {
        await markFailed(event.id, event.attempts, error instanceof Error ? error.message : String(error));
        failed += 1;
      }
    }

    const stats = await outboxStats();

    return NextResponse.json({
      success: true,
      claimed: events.length,
      processed,
      failed,
      unknownHandler: skipped,
      requeuedStale: requeued,
      stats,
    });
  } catch (error) {
    logger.error('Falha no worker do outbox', { error: String(error) }, 'outbox');
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  } finally {
    await lock.release();
  }
}

/**
 * Vercel Cron dispara **GET**. Até aqui a rota só exportava POST: agendar o
 * worker sem este handler trocaria "nunca roda" por "roda e recebe 405" — o
 * outbox continuaria parado e o sintoma ficaria ainda mais difícil de achar.
 *
 * POST continua publicado para disparo manual e para o teste de integração.
 */
export async function GET(request: Request) {
  return runWorker(request);
}

export async function POST(request: Request) {
  return runWorker(request);
}
