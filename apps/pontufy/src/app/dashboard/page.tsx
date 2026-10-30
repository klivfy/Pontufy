'use client';
import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import HeroCourse from '@/components/dashboard/HeroCourse';
import CourseRow from '@/components/dashboard/CourseRow';
import StreakCard from '@/components/dashboard/StreakCard';
import { useCourses, useEnrolledCourses } from '@/hooks/useApi';
import { getCachedCourses, reconcileWithApi, type CachedCourse } from '@/lib/local-courses';
import { Loader2 } from 'lucide-react';

function mergeCourses(apiCourses: any[], local: CachedCourse[]): any[] {
  const apiIds = new Set(apiCourses.map((c: any) => c.id));
  reconcileWithApi(apiIds);
  const fresh = local.filter((c) => !apiIds.has(c.id));
  return [...fresh, ...apiCourses];
}

export default function Home() {
  const { data: coursesResponse, isLoading: loadingCourses } = useCourses();
  const { data: enrolledCourses, isLoading: loadingEnrolled } = useEnrolledCourses();
  const [localCourses, setLocalCourses] = useState<CachedCourse[]>([]);

  useEffect(() => {
    setLocalCourses(getCachedCourses());
  }, []);

  const apiCourses = Array.isArray(coursesResponse?.data) ? coursesResponse.data : [];
  const allCourses = mergeCourses(apiCourses, localCourses);
  const enrolled = Array.isArray(enrolledCourses) ? enrolledCourses : [];

  const searchQuery = useStore((s) => s.searchQuery);

  const filterCourses = (courses: any[]) => {
    if (!searchQuery) return courses;
    return courses.filter(
      (c) =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase())),
    );
  };

  const heroCourse = allCourses[0]
    ? {
        id: allCourses[0].id,
        title: allCourses[0].title,
        description: allCourses[0].description || '',
        duration: `${allCourses[0].lessons?.length || 0} aulas`,
        pointsReward:
          allCourses[0].lessons?.reduce((s: number, l: any) => s + (l.pointsAssigned || 0), 0) || 0,
        thumbnail:
          allCourses[0].imageUrl ||
          'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&q=80&w=1400',
        modules: allCourses[0].lessons?.length || 0,
      }
    : null;

  const inProgress = enrolled
    .filter((c: any) => c.status === 'in_progress')
    .map((c: any) => ({
      id: c.id,
      title: c.title,
      progress: c.progress,
      pointsReward: c.totalLessons * 50,
      thumbnail:
        c.imageUrl ||
        'https://images.unsplash.com/photo-1573164713988-8665fc963095?auto=format&fit=crop&q=80&w=600',
    }));

  const available = allCourses.slice(1).map((c: any) => ({
    id: c.id,
    title: c.title,
    pointsReward:
      c.lessons?.reduce((s: number, l: any) => s + (l.pointsAssigned || 0), 0) || 0,
    thumbnail:
      c.imageUrl ||
      'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&q=80&w=600',
  }));

  const filteredInProgress = filterCourses(inProgress);
  const filteredAvailable = filterCourses(available);

  const isLoading = loadingCourses || loadingEnrolled;

  return (
    <main className="min-h-screen pb-20 bg-md-surface-dim">
      {isLoading ? (
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="animate-spin text-md-primary" size={40} />
        </div>
      ) : (
        <>
          {heroCourse && <HeroCourse course={heroCourse} />}

          <div className="relative z-20 -mt-8 space-y-2 pt-4">
            <div className="px-8 md:px-16 pb-2">
              <StreakCard />
            </div>
            {filteredInProgress.length > 0 && (
              <CourseRow title="Continue de onde parou" courses={filteredInProgress} />
            )}

            {filteredAvailable.length > 0 && (
              <CourseRow title="Trilhas Recomendadas" courses={filteredAvailable} />
            )}

            {filteredInProgress.length === 0 && filteredAvailable.length === 0 && !heroCourse && (
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
      )}
    </main>
  );
}
