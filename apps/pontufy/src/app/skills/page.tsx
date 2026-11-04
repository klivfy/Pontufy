'use client';

import { useEffect, useState } from 'react';
import { Loader2, TreePine } from 'lucide-react';
import SkillTree, { type SkillView } from '@/components/skills/SkillTree';

// TAREFA 12 — Página da Árvore de Habilidades do colaborador.

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillView[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/skills/tree', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.skills) setSkills(data.skills);
        else setError('Erro ao carregar a árvore de habilidades.');
      })
      .catch(() => {
        if (!cancelled) setError('Erro ao conectar ao servidor.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen pb-20 pt-24 bg-md-surface-dim">
      <div className="max-w-5xl mx-auto px-6 md:px-8">
        <header className="mb-6">
          <h1 className="text-3xl font-black text-md-on-surface tracking-tight flex items-center gap-3">
            <TreePine className="text-md-primary" size={28} />
            Trilhas de Competência
          </h1>
          <p className="text-md-on-surface-variant mt-1.5 text-sm">
            Desbloqueie nós concluindo os cursos com nota mínima — cada trilha eleva sua proficiência corporativa.
          </p>
        </header>

        {error && (
          <div className="bg-md-error/25 border border-md-error/20 text-md-error text-sm p-3 rounded-lg text-center font-medium mb-4">
            {error}
          </div>
        )}

        {!skills && !error ? (
          <div className="flex items-center justify-center h-[40vh]">
            <Loader2 className="animate-spin text-md-primary" size={32} />
          </div>
        ) : (
          <SkillTree skills={skills ?? []} />
        )}
      </div>
    </main>
  );
}