import { NextResponse } from 'next/server';

import {
  claimBatch,
  MAX_ATTEMPTS,
  markDone,
  markFailed,
  outboxStats,
  requeueStale,
} from '@/domain/outbox';
import { sendEmailDirect, type EmailPayload } from '@/infra/email';
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

type Handler = (payload: unknown) => Promise<void>;

const HANDLERS: Record<string, Handler> = {
  'email.send': async (payload) => {
    const email = payload as EmailPayload;
    const sent = await sendEmailDirect(email);
    if (!sent) throw new Error('provedor de e-mail recusou o envio');
  },
};

export async function POST(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const lock = await acquireJobLock('cron:outbox-worker', 5);
  if (!lock.acquired) {
    return NextResponse.json({ skipped: true, reason: 'locked' }, { status: 200 });
  }

  try {
    const requeued = await requeueStale();
    const events = await claimBatch(BATCH_SIZE);

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
        await handler(event.payload);
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
