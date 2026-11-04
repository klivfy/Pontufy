'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import HeroCourse from '@/components/dashboard/HeroCourse';
import CourseRow from '@/components/dashboard/CourseRow';
import StreakCard from '@/components/dashboard/StreakCard';
import { useStore } from '@/store/useStore';
import { getCachedCourses, reconcileWithApi, type CachedCourse } from '@/lib/local-courses';

// ═══════════════════════════════════════════════════════════════════════════
// C5 — parte interativa do dashboard.
//
// O servidor entrega catálogo e progresso; aqui ficam as duas coisas que não
// existem no servidor: cursos gerados e guardados em localStorage e a busca
// global (store) que filtra em memória.
//
// `StreakCard` continua client porque busca streak sob demanda; ele não bloqueia
// mais a página inteira — o conteúdo principal já vem renderizado.
// ═══════════════════════════════════════════════════════════════════════════

export interface DashboardCourse {
  id: string;
  title: string;
  description: string | null;
  imageUrl?: string | null;
  lessonsCount: number;
  pointsReward: number;
}

export interface DashboardEnrolled {
  id: string;
  title: string;
  progress: number;
  totalLessons: number;
  status: 'available' | 'in_progress' | 'completed';
}

interface Props {
  initialCourses: DashboardCourse[];
  initialEnrolled: DashboardEnrolled[];
}

const FALLBACK_HERO = 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&q=80&w=1400';
const FALLBACK_PROGRESS = 'https://images.unsplash.com/photo-1573164713988-8665fc963095?auto=format&fit=crop&q=80&w=600';
const FALLBACK_AVAILABLE = 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&q=80&w=600';

export default function DashboardClient({ initialCourses, initialEnrolled }: Props) {
  const [localCourses, setLocalCourses] = useState<CachedCourse[]>([]);
  const searchQuery = useStore((state) => state.searchQuery);

  useEffect(() => {
    setLocalCourses(getCachedCourses());
  }, []);

  const allCourses = useMemo(() => {
    const apiIds = new Set(initialCourses.map((course) => course.id));
    reconcileWithApi(apiIds);
    const freshLocal = localCourses
      .filter((course) => !apiIds.has(course.id))
      .map((course) => ({
        id: course.id,
        title: course.title,
        description: course.description,
        imageUrl: null as string | null,
        lessonsCount: course.lessons.length,
        pointsReward: 0,
      }));
    return [...freshLocal, ...initialCourses];
  }, [initialCourses, localCourses]);

  const matches = (title: string, description?: string | null) => {
    if (!searchQuery) return true;
    const needle = searchQuery.toLowerCase();
    return title.toLowerCase().includes(needle) || (description ?? '').toLowerCase().includes(needle);
  };

  const heroCourse = allCourses[0]
    ? {
        id: allCourses[0].id,
        title: allCourses[0].title,
        description: allCourses[0].description || '',
        duration: `${allCourses[0].lessonsCount} aulas`,
        pointsReward: allCourses[0].pointsReward,
        thumbnail: allCourses[0].imageUrl || FALLBACK_HERO,
        modules: allCourses[0].lessonsCount,
      }
    : null;

  const inProgress = initialEnrolled
    .filter((course) => course.status === 'in_progress')
    .filter((course) => matches(course.title))
    .map((course) => ({
      id: course.id,
      title: course.title,
      progress: course.progress,
      pointsReward: course.totalLessons * 50,
      thumbnail: FALLBACK_PROGRESS,
    }));

  const available = allCourses
    .slice(1)
    .filter((course) => matches(course.title, course.description))
    .map((course) => ({
      id: course.id,
      title: course.title,
      pointsReward: course.pointsReward,
      thumbnail: course.imageUrl || FALLBACK_AVAILABLE,
    }));

  return (
    <>
      {heroCourse && <HeroCourse course={heroCourse} />}

      <div className="relative z-20 -mt-8 space-y-2 pt-4">
        <div className="px-8 md:px-16 pb-2">
          <StreakCard />
        </div>

        {inProgress.length > 0 && <CourseRow title="Continue de onde parou" courses={inProgress} />}

        {available.length > 0 && <CourseRow title="Trilhas Recomendadas" courses={available} />}

        {inProgress.length === 0 && available.length === 0 && !heroCourse && (
          <div className="px-8 md:px-16 py-20 text-center">
            <p className="text-gray-500 text-base">
              {searchQuery
                ? `Nenhum curso encontrado para "${searchQuery}".`
                : 'Nenhum curso disponível ainda. Peça ao seu gestor para criar treinamentos.'}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

/** Mantido para o caso de o layout precisar do mesmo indicador. */
export function DashboardLoading() {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <Loader2 className="animate-spin text-md-primary" size={40} />
    </div>
  );
}
