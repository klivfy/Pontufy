import { NextResponse } from 'next/server';
import { getSessionContext } from '@/infra/session';
import { acquireLock, releaseLock } from '@/infra/mutex';
import { jsonError } from '@/domain/auth';
import { submitQuiz } from '@/domain/learning';
import { logger } from '@/infra/logger';

export { QUIZ_BONUS_POINTS, QUIZ_MIN_PERCENTAGE } from '@/domain/learning';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let lockKey = '';
  try {
    const { tenantId, userId } = await getSessionContext();
    const { id } = await params;
    const body = await request.json().catch(() => null);

    lockKey = `lock:quiz:${tenantId}:${userId}:${id}`;
    const lockAcquired = await acquireLock(lockKey, 10);
    if (!lockAcquired) {
      return NextResponse.json({ error: 'Transação já em andamento. Aguarde.' }, { status: 429 });
    }

    const result = await submitQuiz({ tenantId, userId, courseId: id, answers: body?.answers });
    return NextResponse.json(result);
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('POST /api/courses/[id]/quiz', { error: String(error) }, 'learning');
    return NextResponse.json(mapped.body, { status: mapped.status });
  } finally {
    if (lockKey) await releaseLock(lockKey);
  }
}
