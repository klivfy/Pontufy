'use client';

import type { TopCourse } from './types';

const formatNumber = (value: number): string => new Intl.NumberFormat('pt-BR').format(value);

const STATUS_STYLES: Record<string, string> = {
  published: 'bg-md-tertiary/25 text-md-tertiary border-md-tertiary/20',
  draft: 'bg-md-secondary/25 text-md-secondary border-md-secondary/20',
  removed: 'bg-md-surface-container-high text-md-on-surface-variant border-md-outline',
};

function statusStyle(status: string): string {
  return STATUS_STYLES[status] ?? STATUS_STYLES.removed;
}

function completionRate(course: TopCourse): string {
  if (course.lessonCount === 0 || course.enrolledUsers === 0) return '—';
  const rate = (course.completions / (course.enrolledUsers * course.lessonCount)) * 100;
  return `${rate.toFixed(1)}%`;
}

interface TopCoursesTableProps {
  courses: TopCourse[];
}

export default function TopCoursesTable({ courses }: TopCoursesTableProps) {
  if (!courses.length) {
    return (
      <p className="text-sm text-md-on-surface-variant py-6 text-center">
        Nenhum curso com conclusões registadas ainda.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-md-on-surface-variant uppercase tracking-wide border-b border-md-outline">
            <th className="pb-3 pr-4 font-semibold">Curso</th>
            <th className="pb-3 pr-4 font-semibold">Estado</th>
            <th className="pb-3 pr-4 font-semibold text-right">Conclusões</th>
            <th className="pb-3 pr-4 font-semibold text-right">Colaboradores</th>
            <th className="pb-3 pr-4 font-semibold text-right">Pontos Gerados</th>
            <th className="pb-3 font-semibold text-right">Taxa Média</th>
          </tr>
        </thead>
        <tbody>
          {courses.map((course) => (
            <tr key={course.id} className="border-b border-md-outline-variant last:border-0">
              <td className="py-3 pr-4 text-md-on-surface font-medium max-w-[280px] truncate" title={course.title}>
                {course.title}
              </td>
              <td className="py-3 pr-4">
                <span
                  className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full border capitalize ${statusStyle(course.status)}`}
                >
                  {course.status}
                </span>
              </td>
              <td className="py-3 pr-4 text-md-on-surface text-right">{formatNumber(course.completions)}</td>
              <td className="py-3 pr-4 text-md-on-surface text-right">{formatNumber(course.enrolledUsers)}</td>
              <td className="py-3 pr-4 text-md-on-surface text-right">{formatNumber(course.pointsGenerated)}</td>
              <td className="py-3 text-md-on-surface text-right">{completionRate(course)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
