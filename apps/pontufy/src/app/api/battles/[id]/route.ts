import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/infra/session';
import { acquireLock, releaseLock } from '@/infra/mutex';
import { jsonError } from '@/domain/auth';
import { getOpenTurn, submitTurn } from '@/domain/battles';
import { parseBody } from '@/lib/validations';
import { logger } from '@/infra/logger';

const answerSchema = z.object({
  answers: z.array(z.number().int().min(-1).max(5)).max(10),
  elapsedSeconds: z.number().int().min(0).max(600),
  focusLost: z.boolean().optional(),
});

export { BATTLE_POINTS_PER_CORRECT } from '@/domain/battles';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { tenantId, userId } = await getSessionContext();
    const { id } = await params;
    const turn = await getOpenTurn(tenantId, userId, id);
    return NextResponse.json({ success: true, ...turn });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('GET /api/battles/[id]', { error: String(error) }, 'battles');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let lockKey = '';
  try {
    const { tenantId, userId } = await getSessionContext();
    const { id } = await params;
    const raw = await request.json().catch(() => null);
    const { data, error } = parseBody(answerSchema, raw);
    if (error) return NextResponse.json({ error }, { status: 400 });

    lockKey = `lock:battle:${tenantId}:${id}`;
    const lockAcquired = await acquireLock(lockKey, 10);
    if (!lockAcquired) {
      return NextResponse.json({ error: 'Transação já em andamento. Aguarde.' }, { status: 429 });
    }

    const result = await submitTurn(tenantId, userId, id, {
      answers: data.answers,
      elapsedSeconds: data.elapsedSeconds,
      focusLost: data.focusLost ?? false,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('POST /api/battles/[id]', { error: String(error) }, 'battles');
    return NextResponse.json(mapped.body, { status: mapped.status });
  } finally {
    if (lockKey) await releaseLock(lockKey);
  }
}
