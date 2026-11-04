import Link from 'next/link';
import { Sparkles, Users, Edit, Eye, Trash2, MoreVertical } from 'lucide-react';

interface CourseRow {
  id: string;
  title: string;
  status: 'Publicado' | 'Rascunho';
  enrolled: number;
  date: string;
}

export default function AISelectionTable({ courses }: { courses: CourseRow[] }) {
  if (courses.length === 0) {
    return (
      <div className="p-8 text-center">
        <Sparkles size={48} className="mx-auto text-md-on-surface-variant mb-4" />
        <p className="text-body-md text-md-on-surface-variant">Nenhum curso gerado ainda</p>
        <p className="text-body-sm text-md-on-surface-variant mt-1">Use o assistente de IA para criar o primeiro curso</p>
        <Link href="/admin/wizard" className="md-btn md-btn-filled mt-4 inline-flex">
          <Sparkles size={18} className="mr-2" />
          Gerar primeiro curso
        </Link>
      </div>
    );
  }

  return (
    <div className="md-card-outlined md-elevation-1 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead>
            <tr className="bg-md-surface-container-high/50 text-md-on-surface-variant text-label-sm uppercase tracking-wider border-b border-md-outline">
              <th className="px-4 sm:px-6 py-3 font-semibold">Título do Curso</th>
              <th className="px-3 sm:px-6 py-3 font-semibold text-center">Status</th>
              <th className="px-3 sm:px-6 py-3 font-semibold text-center">Engajamento</th>
              <th className="px-3 sm:px-6 py-3 font-semibold text-right whitespace-nowrap">Data</th>
              <th className="px-4 py-3 font-semibold text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-md-outline">
            {courses.map((course) => (
              <tr key={course.id} className="hover:bg-md-surface-container-high/50 transition-colors">
                <td className="px-4 sm:px-6 py-4 font-medium text-md-on-surface max-w-[300px] truncate">{course.title}</td>
                <td className="px-3 sm:px-6 py-4 text-center">
                  <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-label-sm font-semibold ${
                    course.status === 'Publicado'
                      ? 'bg-md-tertiary-container text-md-on-tertiary-container'
                      : 'bg-md-surface-container-high text-md-on-surface-variant'
                  }`}>
                    {course.status}
                  </span>
                </td>
                <td className="px-3 sm:px-6 py-4 text-center text-md-on-surface-variant font-medium">
                  <span className="inline-flex items-center justify-center gap-1.5">
                    <Users size={16} className="text-md-on-surface-variant" />
                    {course.enrolled}
                  </span>
                </td>
                <td className="px-3 sm:px-6 py-4 text-right text-md-on-surface-variant text-body-sm whitespace-nowrap">{course.date}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/admin/wizard?edit=${course.id}`}
                      className="p-2 rounded-xl text-md-on-surface-variant hover:bg-md-surface-container-high hover:text-md-primary transition-colors"
                      title="Editar"
                    >
                      <Edit size={18} />
                    </Link>
                    <button
                      type="button"
                      className="p-2 rounded-xl text-md-on-surface-variant hover:bg-md-surface-container-high hover:text-md-secondary transition-colors"
                      title="Visualizar"
                    >
                      <Eye size={18} />
                    </button>
                    <button
                      type="button"
                      className="p-2 rounded-xl text-md-on-surface-variant hover:bg-md-error/10 hover:text-md-error transition-colors"
                      title="Excluir"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}