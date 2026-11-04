'use client';

import { useEffect, useState } from 'react';
import { Flame, Trophy, AlertTriangle, Loader2 } from 'lucide-react';

// TAREFA 11 — Widget de streak do usuário (dados de /api/gamification).

interface StreakData {
  current: number;
  best: number;
  atRisk: boolean;
}

export default function StreakCard() {
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [rank, setRank] = useState<{ position: number; xp: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/gamification', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setStreak(data.streak);
        setRank(data.myRank);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!streak) {
    return (
      <div className="flex items-center justify-center py-8 bg-md-surface border border-md-outline rounded-xl">
        <Loader2 className="animate-spin text-md-primary" size={20} />
      </div>
    );
  }

  const fireColor = streak.current >= 7 ? 'text-md-secondary' : streak.current >= 3 ? 'text-md-secondary' : 'text-md-on-surface-variant';

  return (
    <section className="bg-md-surface border border-md-outline rounded-xl p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Flame className={fireColor} size={28} />
          <div>
            <p className="text-2xl font-black text-md-on-surface leading-none">
              {streak.current} {streak.current === 1 ? 'dia' : 'dias'}
            </p>
            <p className="text-xs text-md-on-surface-variant mt-1">
              {streak.atRisk
                ? 'Streak em risco: conclua uma aula hoje!'
                : streak.current === 0
                  ? 'Conclua uma aula hoje para iniciar seu streak'
                  : 'sequência consecutiva de aprendizado'}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="flex items-center justify-end gap-1.5 text-sm font-bold text-md-tertiary">
            <Trophy size={15} /> Recorde: {streak.best}
          </p>
          {rank && (
            <p className="text-xs text-md-on-surface-variant mt-1">
              #{rank.position} no ranking · {rank.xp} XP
            </p>
          )}
        </div>
      </div>

      {streak.atRisk && (
        <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-md-secondary bg-md-secondary/25 border border-md-secondary/20 rounded-lg px-3 py-2">
          <AlertTriangle size={14} />
          Não perca seu streak: complete pelo menos uma aula hoje.
        </div>
      )}
    </section>
  );
}