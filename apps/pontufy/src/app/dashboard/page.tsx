import { Suspense } from 'react';

import { getSessionContext } from '@/infra/session';
import { getTenantDb } from '@/infra/db';
import DashboardClient, { type DashboardCourse, type DashboardEnrolled } from './DashboardClient';

// ═══════════════════════════════════════════════════════════════════════════
// C5 — Fronteira RSC: dashboard.
//
// Antes: `useCourses()` + `useEnrolledCourses()` no cliente e um spinner
// ocupando toda a tela — a home do colaborador era a última a ter conteúdo.
//
// Agora catálogo e progresso chegam no HTML. O cliente resolve o que é local:
// cursos em localStorage e a busca global em memória.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { userId, tenantId } = await getSessionContext();
  const db = getTenantDb(tenantId);

  const [courses, completions] = await Promise.all([
    db.course.findMany({
      where: { status: 'published' },
      include: { lessons: { select: { id: true, pointsAssigned: true } } },
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
    db.lessonCompletion.findMany({ where: { userId }, select: { lessonId: true } }),
  ]);

  const completedIds = new Set(completions.map((completion) => completion.lessonId));

  const initialCourses: DashboardCourse[] = courses.map((course) => ({
    id: course.id,
    title: course.title,
    description: course.description,
    imageUrl: null,
    lessonsCount: course.lessons.length,
    pointsReward: course.lessons.reduce((sum, lesson) => sum + (lesson.pointsAssigned ?? 0), 0),
  }));

  const initialEnrolled: DashboardEnrolled[] = courses.map((course) => {
    const totalLessons = course.lessons.length;
    const completedLessons = course.lessons.filter((lesson) => completedIds.has(lesson.id)).length;
    const progress = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    let status: DashboardEnrolled['status'] = 'available';
    if (completedLessons > 0 && completedLessons < totalLessons) status = 'in_progress';
    else if (completedLessons === totalLessons && totalLessons > 0) status = 'completed';

    return {
      id: course.id,
      title: course.title,
      progress,
      totalLessons,
      status,
    };
  });

  return (
    <main className="min-h-screen pb-20 bg-md-surface-dim">
      <Suspense fallback={<div className="h-[60vh]" />}>
        <DashboardClient initialCourses={initialCourses} initialEnrolled={initialEnrolled} />
      </Suspense>
    </main>
  );
}
