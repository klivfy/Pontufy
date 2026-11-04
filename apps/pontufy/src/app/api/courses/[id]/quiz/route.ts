import { NextResponse } from 'next/server';
import { getSessionContext } from '@/infra/session';
import { acquireLock, releaseLock, type LockHandle } from '@/infra/mutex';
import { jsonError } from '@/domain/auth';
import { prepareQuiz, submitQuiz } from '@/domain/learning';
import { logger } from '@/infra/logger';

// Arquivo de rota só pode exportar handlers HTTP: reexportar constantes daqui
// faz o type-check do Next recusar o módulo (as constantes vivem em
// `@/domain/learning`).

/**
 * GET — sorteia a tentativa.
 *
 * Devolve apenas pergunta e alternativas: gabarito e explicação nunca saem do
 * servidor antes da correção. A semente volta junto porque é ela que permite o
 * servidor recompor exatamente o mesmo conjunto no POST — o cliente não escolhe
 * quais questões vai responder, só o "nº do sorteio".
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { tenantId, userId } = await getSessionContext();
    const { id } = await params;
    const seed = new URL(request.url).searchParams.get('seed') ?? undefined;

    const selection = await prepareQuiz({ tenantId, userId, courseId: id, seed });
    return NextResponse.json(selection);
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) {
      logger.error('GET /api/courses/[id]/quiz', { error: String(error) }, 'learning');
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let lock: LockHandle | null = null;
  try {
    const { tenantId, userId } = await getSessionContext();
    const { id } = await params;
    const body = await request.json().catch(() => null);

    lock = await acquireLock(`lock:quiz:${tenantId}:${userId}:${id}`, 10);
    if (!lock) {
      return NextResponse.json({ error: 'Transação já em andamento. Aguarde.' }, { status: 429 });
    }

    const result = await submitQuiz({
      tenantId,
      userId,
      courseId: id,
      answers: body?.answers,
      seed: typeof body?.seed === 'string' ? body.seed : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('POST /api/courses/[id]/quiz', { error: String(error) }, 'learning');
    return NextResponse.json(mapped.body, { status: mapped.status });
  } finally {
    await releaseLock(lock);
  }
}
