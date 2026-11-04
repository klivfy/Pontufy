'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PlayCircle, CheckCircle2, BookOpen, Clock, Award } from 'lucide-react';

import { getCachedCourses, reconcileWithApi, type CachedCourse } from '@/lib/local-courses';
import { useStore } from '@/store/useStore';

// ═══════════════════════════════════════════════════════════════════════════
// C5 — parte interativa de "Meus Cursos".
//
// O servidor entrega `initialCourses` e `certCourseIds`. O cliente continua
// dono de duas coisas que NÃO existem no servidor:
//   1. cursos gerados e guardados em localStorage (`getCachedCourses`);
//   2. filtro e busca — agora na URL (`?status=&q=`), então sobrevivem a
//      reload e podem ser compartilhados.
//
// Antes, filtro e busca eram `useState`: recarregar a página perdia tudo.
// ═══════════════════════════════════════════════════════════════════════════

export type FilterStatus = 'all' | 'in_progress' | 'completed' | 'available';

export interface EnrolledCourse {
  id: string;
  title: string;
  description: string | null;
  totalLessons: number;
  completedLessons: number;
  progress: number;
  status: 'available' | 'in_progress' | 'completed';
}

interface Props {
  initialCourses: EnrolledCourse[];
  certCourseIds: string[];
}

const FILTERS: { key: FilterStatus; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'in_progress', label: 'Em Andamento' },
  { key: 'completed', label: 'Concluídos' },
  { key: 'available', label: 'Disponíveis' },
];

const STATUS_CONFIG = {
  completed: {
    icon: <CheckCircle2 size={16} className="text-md-tertiary" />,
    badge: 'bg-md-tertiary-container text-md-on-tertiary-container border-md-tertiary/30',
    label: 'Concluído',
  },
  in_progress: {
    icon: <PlayCircle size={16} className="text-md-secondary" />,
    badge: 'bg-md-secondary-container text-md-on-secondary-container border-md-secondary/30',
    label: 'Em andamento',
  },
  available: {
    icon: <BookOpen size={16} className="text-md-on-surface-variant" />,
    badge: 'bg-md-surface-container-low text-md-on-surface-variant border-md-outline-variant',
    label: 'Disponível',
  },
} as const;

function localToEnrolled(course: CachedCourse): EnrolledCourse {
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    totalLessons: course.lessons.length,
    completedLessons: 0,
    progress: 0,
    status: 'available',
  };
}

export default function CoursesClient({ initialCourses, certCourseIds }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSearchQuery = useStore((s) => s.setSearchQuery);

  const filter = (searchParams.get('status') as FilterStatus) ?? 'all';
  const query = searchParams.get('q') ?? '';

  const [localCourses, setLocalCourses] = useState<CachedCourse[]>([]);

  // localStorage não existe no servidor: a leitura acontece na montagem.
  useEffect(() => {
    setLocalCourses(getCachedCourses());
  }, []);

  // Mantém a busca global do app em sincronia quando a página abre com ?q=.
  useEffect(() => {
    if (query) setSearchQuery(query);
  }, [query, setSearchQuery]);

  const certs = useMemo(() => new Set(certCourseIds), [certCourseIds]);

  const merged = useMemo(() => {
    const apiIds = new Set(initialCourses.map((course) => course.id));
    reconcileWithApi(apiIds);
    const onlyLocal = localCourses
      .filter((course) => !apiIds.has(course.id))
      .map(localToEnrolled);
    return [...onlyLocal, ...initialCourses];
  }, [initialCourses, localCourses]);

  const filtered = useMemo(
    () =>
      merged
        .filter((course) => filter === 'all' || course.status === filter)
        .filter((course) => {
          if (!query) return true;
          const needle = query.toLowerCase();
          return (
            course.title.toLowerCase().includes(needle) ||
            (course.description?.toLowerCase().includes(needle) ?? false)
          );
        }),
    [merged, filter, query],
  );

  function updateParams(next: { status?: FilterStatus; q?: string | null }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.status) params.set('status', next.status);
    if (next.q !== undefined) {
      if (next.q) params.set('q', next.q);
      else params.delete('q');
    }
    router.replace(`/cursos${params.size > 0 ? `?${params.toString()}` : ''}`, { scroll: false });
  }

  return (
    <>
      <div className="flex gap-2 mb-8 flex-wrap">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            onClick={() => updateParams({ status: option.key })}
            aria-pressed={filter === option.key}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all border ${
              filter === option.key
                ? 'bg-md-tertiary text-white border-md-tertiary shadow-lg shadow-md-tertiary/30'
                : 'bg-md-surface-container-high text-md-on-surface-variant border-md-outline hover:border-md-outline hover:text-md-on-surface'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-24 text-md-on-surface-muted">
          {query ? `Nenhum curso encontrado para "${query}".` : 'Nenhum curso nesta categoria.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((course) => {
            const config = STATUS_CONFIG[course.status] ?? STATUS_CONFIG.available;
            return (
              <Link
                key={course.id}
                href={`/player/${course.id}`}
                className="flex flex-col bg-md-surface-container-lowest border border-md-outline-variant rounded-2xl overflow-hidden hover:border-md-primary/30 hover:shadow-lg md-elevation-1 transition-all duration-200 group block"
              >
                <div className="h-1 bg-md-surface-container-high">
                  <div
                    className="h-full bg-md-tertiary transition-all duration-500"
                    style={{ width: `${course.progress}%` }}
                  />
                </div>

                <div className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="font-bold text-md-on-surface text-base leading-tight group-hover:text-md-tertiary transition-colors">
                      {course.title}
                    </h3>
                    {config.icon}
                  </div>

                  {course.description && (
                    <p className="text-xs text-md-on-surface-variant line-clamp-2 mb-4 leading-relaxed">
                      {course.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between mt-auto">
                    <div className="flex items-center gap-1.5 text-xs text-md-on-surface-muted">
                      <Clock size={12} />
                      <span>
                        {course.completedLessons}/{course.totalLessons} aulas
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {certs.has(course.id) && (
                        <span className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full border bg-md-secondary/25 text-md-secondary border-md-secondary/20">
                          <Award size={11} /> Certificado
                        </span>
                      )}
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${config.badge}`}>
                        {course.progress > 0 ? `${course.progress}%` : config.label}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
