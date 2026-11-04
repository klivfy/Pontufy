'use client';

import { useEffect, useState } from 'react';
import { Trophy, Users, Timer, Gift, Loader2 } from 'lucide-react';

// TAREFA 13.2/13.3/13.5 — Ranking semanal interdepartamental (Redis em tempo
// real) + progresso do bônus coletivo (meta de horas do departamento).

export interface DeptRankEntry {
  department: string;
  points: number;
  members: number;
  hours: number;
  goalHours: number;
  goalMet: boolean;
  bonusAwarded: boolean;
}

export default function LeaderboardCard() {
  const [ranking, setRanking] = useState<DeptRankEntry[] | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    fetch('/api/battles/leaderboard', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.ranking) setRanking(data.ranking);
        else setError('Erro ao carregar o ranking.');
      })
      .catch(() => setError('Erro ao conectar ao servidor.'));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000); // 13.3 — sync periódico via Redis
    return () => clearInterval(interval);
  }, []);

  const medals = ['bg-md-secondary text-md-on-secondary', 'bg-md-surface-container-high text-md-on-surface', 'bg-md-secondary text-white'];

  return (
    <section className="bg-md-surface-container border border-md-outline-variant rounded-2xl p-5">
      <header className="flex items-center gap-2 mb-4">
        <Trophy className="text-md-primary" size={20} />
        <h2 className="text-lg font-black text-md-on-surface tracking-tight">
          Ranking Interdepartamental
        </h2>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-md-on-surface-variant bg-md-surface-container-low border border-md-outline-variant rounded-full px-2.5 py-1">
          Semana atual
        </span>
      </header>

      {error && (
        <p className="text-md-error text-sm text-center py-6">{error}</p>
      )}
      {!ranking && !error && (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-md-primary" size={26} />
        </div>
      )}

      {ranking && ranking.length === 0 && (
        <div className="text-center py-10">
          <Users className="mx-auto text-md-on-surface-muted mb-3" size={36} />
          <p className="text-md-on-surface-variant text-sm">
            Nenhum departamento definido ainda. Defina o seu departamento no perfil para entrar no ranking.
          </p>
        </div>
      )}

      {ranking && ranking.length > 0 && (
        <div className="space-y-3">
          {ranking.map((entry, i) => {
            const pct = entry.goalHours > 0 ? Math.min(100, Math.round((entry.hours / entry.goalHours) * 100)) : 0;
            return (
              <div
                key={entry.department}
                className="rounded-xl border border-md-outline-variant bg-md-surface-container-low p-4"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-black shrink-0 ${
                      medals[i] ?? 'bg-md-surface-container-high text-md-on-surface-variant'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-md-on-surface text-sm truncate">{entry.department}</p>
                    <p className="text-xs text-md-on-surface-variant">
                      {entry.members} {entry.members === 1 ? 'membro' : 'membros'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-md-primary text-lg leading-none">
                      {entry.points.toLocaleString('pt-BR')}
                    </p>
                    <p className="text-[10px] text-md-on-surface-variant mt-1">pontos</p>
                  </div>
                </div>

                {/* 13.5 — Progresso da meta semanal de horas */}
                <div className="mt-3 flex items-center gap-2">
                  <Timer size={14} className="text-md-on-surface-variant shrink-0" />
                  <div className="flex-1 h-2 bg-md-surface-container-high rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${entry.goalMet ? 'bg-md-tertiary' : 'bg-md-primary'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-md-on-surface-variant whitespace-nowrap">
                    {entry.hours.toFixed(1)}h / {entry.goalHours}h
                  </span>
                </div>

                {entry.goalMet && (
                  <p className="mt-2 text-[11px] font-semibold text-md-tertiary flex items-center gap-1.5">
                    <Gift size={13} />
                    {entry.bonusAwarded
                      ? 'Bônus coletivo de 25 pts concedido esta semana!'
                      : 'Meta atingida! Aguarde o bônus coletivo.'}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}