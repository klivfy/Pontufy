import { Suspense } from 'react';

import { getSessionContext } from '@/infra/session';
import { getTenantDb } from '@/infra/db';
import CoursesClient, { type EnrolledCourse } from './CoursesClient';

// ═══════════════════════════════════════════════════════════════════════════
// C5 — Fronteira RSC: "Meus Cursos".
//
// Antes: dois fetches no cliente (`/api/courses/enrolled` e `/api/certificates`)
// e um spinner ocupando a tela inteira antes de qualquer conteúdo.
//
// Agora o servidor resolve cursos, progresso e certificados na mesma consulta
// de sessão. O cliente cuida do que é local por natureza: cursos em
// localStorage, filtro e busca (esses agora na URL).
//
// `Suspense` é obrigatório aqui porque `CoursesClient` usa `useSearchParams`.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  const { userId, tenantId } = await getSessionContext();
  const db = getTenantDb(tenantId);

  const courses = await db.course.findMany({
    where: { status: 'published' },
    include: { lessons: { select: { id: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const lessonIds = courses.flatMap((course) => course.lessons.map((lesson) => lesson.id));

  const [completions, certificates] = await Promise.all([
    lessonIds.length > 0
      ? db.lessonCompletion.findMany({
          where: { userId, lessonId: { in: lessonIds } },
          select: { lessonId: true },
        })
      : Promise.resolve([]),
    db.issuedCertificate.findMany({ where: { userId }, select: { courseId: true } }),
  ]);

  const completedIds = new Set(completions.map((completion) => completion.lessonId));

  const initialCourses: EnrolledCourse[] = courses.map((course) => {
    const totalLessons = course.lessons.length;
    const completedLessons = course.lessons.filter((lesson) => completedIds.has(lesson.id)).length;
    const progress = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    let status: EnrolledCourse['status'] = 'available';
    if (completedLessons > 0 && completedLessons < totalLessons) status = 'in_progress';
    else if (completedLessons === totalLessons && totalLessons > 0) status = 'completed';

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      totalLessons,
      completedLessons,
      progress,
      status,
    };
  });

  const certCourseIds = certificates.map((certificate) => certificate.courseId);

  return (
    <main className="min-h-screen pb-20 pt-24 bg-[#0a0a0a]">
      <div className="max-w-[1200px] mx-auto px-6 md:px-16">
        <header className="mb-8">
          <h1 className="text-3xl font-black text-white tracking-tight">Meus Cursos & Trilhas</h1>
          <p className="text-gray-500 mt-1.5 text-sm">
            Acompanhe seu progresso em todas as trilhas de aprendizagem.
          </p>
        </header>

        <Suspense fallback={<div className="h-12" />}>
          <CoursesClient initialCourses={initialCourses} certCourseIds={certCourseIds} />
        </Suspense>
      </div>
    </main>
  );
}
