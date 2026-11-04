import { NextResponse } from 'next/server';
import { getSessionContext } from '@/backend/session';
import { getTenantDb } from '@/backend/db';
import { parseQuizModules } from '@/schemas/quiz';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { tenantId, userId } = await getSessionContext();
    const { id } = await params;
    const db = getTenantDb(tenantId);

    const course = await db.course.findFirst({
      where: { id, status: 'published' },
      include: {
        lessons: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!course) {
      return NextResponse.json({ error: 'Curso não encontrado.' }, { status: 404 });
    }

    const completions = await db.lessonCompletion.findMany({
      where: {
        userId,
        lessonId: { in: course.lessons.map((l) => l.id) },
      },
      select: { lessonId: true },
    });

    const completedIds = new Set(completions.map((c) => c.lessonId));

    const lessons = course.lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      type: lesson.type,
      contentUrl: lesson.contentUrl,
      points: lesson.pointsAssigned,
      completed: completedIds.has(lesson.id),
    }));

    // A3 — JSON nativo: o campo já é objeto. `parseQuizModules` valida o
    // contrato e devolve [] se a linha for antiga/inválida, sem derrubar a tela.
    const quiz = parseQuizModules(course.quizJson);

    // Indica se o usuário já aprovou o quiz final (>= 70%, gravado server-side).
    let quizPassed = false;
    if (quiz) {
      const passedAttempt = await db.quizAttempt.findFirst({
        where: { userId, courseId: id, passed: true },
        select: { id: true },
      });
      quizPassed = !!passedAttempt;
    }

    return NextResponse.json({
      id: course.id,
      title: course.title,
      description: course.description,
      lessons,
      quiz,
      quizPassed,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Não autenticado.') {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    console.error('GET /api/courses/[id]:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
