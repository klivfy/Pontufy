import { NextResponse } from 'next/server';
import { withRouteMetrics } from '@/infra/metrics';
import { getSessionContext } from '@/infra/session';
import { acquireLock, releaseLock, type LockHandle } from '@/infra/mutex';
import { jsonError } from '@/domain/auth';
import { completeLesson } from '@/domain/learning';
import { getClientIp, ipRateLimit } from '@/lib/security/auth-guard';
import { tenantRateLimit } from '@/lib/security/rate-limit';
import { completeLessonSchema, parseBody } from '@/lib/validations';
import { logger } from '@/infra/logger';

const LESSON_IP_MAX = 60;
const LESSON_IP_WINDOW = 60;
const LESSON_TENANT_MAX = 1200;
const LESSON_TENANT_WINDOW = 60;

async function handlePost(request: Request) {
  const ip = getClientIp(request);
  const ipRate = await ipRateLimit(ip, 'lessons-complete', LESSON_IP_MAX, LESSON_IP_WINDOW);
  if (!ipRate.allowed) {
    return NextResponse.json({ error: 'Muitas requisições. Aguarde um instante.' }, { status: 429 });
  }

  let lock: LockHandle | null = null;
  try {
    const { tenantId, userId } = await getSessionContext();
    const tenantRate = await tenantRateLimit(tenantId, 'lessons-complete', LESSON_TENANT_MAX, LESSON_TENANT_WINDOW);
    if (!tenantRate.allowed) {
      return NextResponse.json({ error: 'Limite da empresa atingido. Tente novamente em instantes.' }, { status: 429 });
    }

    const raw = await request.json().catch(() => null);
    const { data: body, error: validationError } = parseBody(completeLessonSchema, raw);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    // O schema garante via `refine` que pelo menos um dos identificadores veio.
    const lessonId = body.lessonId ?? body.lessonSlug;
    if (!lessonId) {
      return NextResponse.json({ error: 'lessonId é obrigatório.' }, { status: 400 });
    }

    lock = await acquireLock(`lock:lesson:${tenantId}:${userId}:${lessonId}`, 10);
    if (!lock) {
      return NextResponse.json({ error: 'Transação já em andamento. Aguarde.' }, { status: 429 });
    }

    const result = await completeLesson({ tenantId, userId, lessonId });
    return NextResponse.json(result);
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('POST /api/lessons/complete', { error: String(error) }, 'learning');
    return NextResponse.json(mapped.body, { status: mapped.status });
  } finally {
    await releaseLock(lock);
  }
}

// B4 — SLO: latência e taxa de erro desta rota.
// O buffer é do processo (somente leitura, sem efeito no fluxo).
export async function POST(request: Request) {
  return withRouteMetrics('lessons/complete', () => handlePost(request));
}
