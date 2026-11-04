'use client';

import { useEffect, useState } from 'react';
import { Trophy, Lock, Loader2 } from 'lucide-react';

// TAREFA 11.4 — Galeria de conquistas do usuário (de /api/gamification).

interface AchievementDef {
  id: string;
  title: string;
  description: string;
  emoji: string;
}

const ALL_ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_steps', title: 'Primeiros Passos', description: 'Concluiu sua primeira aula.', emoji: '🌱' },
  { id: 'streak_3', title: 'Ritmo Constante', description: '3 dias seguidos de aprendizado.', emoji: '🔥' },
  { id: 'streak_7', title: 'Semana Perfeita', description: '7 dias seguidos de aprendizado.', emoji: '⚡' },
  { id: 'streak_30', title: 'Mês Consistente', description: '30 dias seguidos de aprendizado.', emoji: '🏆' },
  { id: 'ten_lessons', title: 'Dedicação', description: '10 aulas concluídas.', emoji: '📚' },
  { id: 'fifty_lessons', title: 'Máquina de Aprendizado', description: '50 aulas concluídas.', emoji: '🚀' },
  { id: 'hundred_points', title: 'Colecionador', description: 'Acumulou 100 pontos ganhos.', emoji: '💎' },
  { id: 'thousand_points', title: 'Lenda Pontufy', description: 'Acumulou 1.000 pontos ganhos.', emoji: '👑' },
];

export default function AchievementsCard() {
  const [unlocked, setUnlocked] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/gamification', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setUnlocked(new Set<string>(data.achievements ?? []));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="bg-md-surface border border-md-outline rounded-xl p-6">
      <h3 className="font-bold text-md-on-surface mb-1 flex items-center gap-2">
        <Trophy size={17} className="text-md-tertiary" /> Conquistas
      </h3>
      <p className="text-sm text-md-on-surface-variant mb-4">
        Desbloqueie marcos de aprendizado e mantenha seu streak de dias.
      </p>

      {!unlocked ? (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin text-md-primary" size={20} />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {ALL_ACHIEVEMENTS.map((a) => {
            const isUnlocked = unlocked.has(a.id);
            return (
              <div
                key={a.id}
                className={`rounded-xl border p-3 text-center transition-colors ${
                  isUnlocked
                    ? 'bg-md-primary/10 border-md-primary/30'
                    : 'bg-md-surface-container border-md-outline opacity-60'
                }`}
                title={a.description}
              >
                <div className={`text-2xl mb-1 ${isUnlocked ? '' : 'grayscale'}`}>{a.emoji}</div>
                <p className={`text-xs font-bold leading-tight ${isUnlocked ? 'text-md-on-surface' : 'text-md-on-surface-variant'}`}>
                  {a.title}
                </p>
                <p className="text-[10px] text-md-on-surface-variant mt-0.5 leading-tight">{a.description}</p>
                {!isUnlocked && <Lock size={10} className="inline mt-1 text-md-on-surface-muted" />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}