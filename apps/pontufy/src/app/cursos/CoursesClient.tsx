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
    icon: <CheckCircle2 size={16} className="text-emerald-400" />,
    badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    label: 'Concluído',
  },
  in_progress: {
    icon: <PlayCircle size={16} className="text-amber-400" />,
    badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    label: 'Em andamento',
  },
  available: {
    icon: <BookOpen size={16} className="text-gray-500" />,
    badge: 'bg-white/5 text-gray-400 border-white/10',
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
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-900/30'
                : 'bg-[#1f1f1f] text-gray-400 border-[#2a2a2a] hover:border-[#3a3a3a] hover:text-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-24 text-gray-600">
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
                className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden hover:border-[#3a3a3a] hover:bg-[#1a1a1a] transition-all duration-200 group block"
              >
                <div className="h-1 bg-[#1f1f1f]">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
                    style={{ width: `${course.progress}%` }}
                  />
                </div>

                <div className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="font-bold text-white text-base leading-tight group-hover:text-emerald-400 transition-colors">
                      {course.title}
                    </h3>
                    {config.icon}
                  </div>

                  {course.description && (
                    <p className="text-xs text-gray-500 line-clamp-2 mb-4 leading-relaxed">
                      {course.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between mt-auto">
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                      <Clock size={12} />
                      <span>
                        {course.completedLessons}/{course.totalLessons} aulas
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {certs.has(course.id) && (
                        <span className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20">
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
