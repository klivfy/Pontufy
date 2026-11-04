'use client';

import { useEffect, useState } from 'react';
import { Swords, Users, Loader2, Hourglass, CheckCircle2, XCircle } from 'lucide-react';
import BattleArena from '@/components/battles/BattleArena';
import LeaderboardCard from '@/components/battles/LeaderboardCard';

// TAREFA 13 — Batalhas de Conhecimento: desafio 1x1 assíncrono (13.1),
// ranking interdepartamental (13.2) e bônus coletivo (13.5).

interface BattleView {
  id: string;
  status: string;
  challengerName: string;
  opponentName: string;
  challengerScore: number;
  opponentScore: number;
  challengerAnswered: boolean;
  opponentAnswered: boolean;
  forfeitedBy: string | null;
  winnerId: string | null;
  createdAt: string;
  expiresAt: string;
  isMine: 'challenger' | 'opponent' | null;
}

interface Colleague {
  id: string;
  name: string;
  department: string | null;
}

export default function BattlesPage() {
  const [battles, setBattles] = useState<BattleView[] | null>(null);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [selectedOpponent, setSelectedOpponent] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeBattleId, setActiveBattleId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    fetch('/api/battles', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.battles) setBattles(data.battles);
        else setError('Erro ao carregar as batalhas.');
      })
      .catch(() => setError('Erro ao conectar ao servidor.'));

    fetch('/api/battles/opponents', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.users) setColleagues(data.users);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 20_000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = async () => {
    if (!selectedOpponent || creating) return;
    setCreating(true);
    setNotice('');
    try {
      const res = await fetch('/api/battles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opponentId: selectedOpponent }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Erro ao criar o desafio.');
        return;
      }
      setSelectedOpponent('');
      setNotice('Desafio enviado! Aguarde o colega responder.');
      load();
    } catch {
      setError('Erro de conexão ao criar o desafio.');
    } finally {
      setCreating(false);
    }
  };

  const canPlay = (b: BattleView) => {
    if (b.status === 'completed') return false;
    if (new Date(b.expiresAt).getTime() < Date.now()) return false;
    if (!b.isMine) return false;
    if (b.isMine === 'challenger') return !b.challengerAnswered;
    return b.challengerAnswered && !b.opponentAnswered;
  };

  const statusLabel = (b: BattleView) => {
    if (b.status === 'completed') {
      if (!b.winnerId) return 'Empate';
      return `${b.challengerScore > b.opponentScore ? b.challengerName : b.opponentName} venceu`;
    }
    if (new Date(b.expiresAt).getTime() < Date.now()) return 'Expirado';
    if (b.isMine === 'challenger') return b.challengerAnswered ? 'Aguardando o oponente' : 'Seu turno!';
    if (b.isMine === 'opponent') return b.challengerAnswered && !b.opponentAnswered ? 'Seu turno!' : 'Aguardando o desafiante';
    return 'Em andamento';
  };

  return (
    <main className="min-h-screen pb-20 pt-24 bg-md-surface-dim">
      <div className="max-w-5xl mx-auto px-6 md:px-8">
        <header className="mb-8">
          <h1 className="text-3xl font-black text-md-on-surface tracking-tight flex items-center gap-3">
            <Swords className="text-md-primary" size={28} />
            Batalhas de Conhecimento
          </h1>
          <p className="text-md-on-surface-variant mt-1.5 text-sm">
            Desafie um colega para um duelo de 5 questões com 15 segundos cada — seus acertos
            alimentam o ranking do seu departamento.
          </p>
        </header>

        {error && (
          <div className="bg-md-error/25 border border-md-error/20 text-md-error text-sm p-3 rounded-lg text-center font-medium mb-4">
            {error}
          </div>
        )}
        {notice && (
          <div className="bg-md-tertiary/25 border border-md-tertiary/20 text-md-tertiary text-sm p-3 rounded-lg text-center font-medium mb-4">
            {notice}
          </div>
        )}

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Coluna principal: criar desafio + lista */}
          <div className="lg:col-span-3 space-y-6">
            {/* Criação de desafio */}
            <section className="bg-md-surface-container border border-md-outline-variant rounded-2xl p-5">
              <h2 className="text-lg font-black text-md-on-surface tracking-tight flex items-center gap-2 mb-4">
                <Users size={20} className="text-md-primary" />
                Novo duelo
              </h2>
              <div className="flex gap-3">
                <select
                  value={selectedOpponent}
                  onChange={(e) => setSelectedOpponent(e.target.value)}
                  className="flex-1 bg-md-surface-container-lowest border border-md-outline rounded-xl px-4 py-3 text-sm text-md-on-surface placeholder:text-md-on-surface-muted outline-none focus:border-md-primary"
                >
                  <option value="">Escolha um colega…</option>
                  {colleagues.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.department ? ` — ${c.department}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleCreate}
                  disabled={!selectedOpponent || creating}
                  className="px-6 py-3 rounded-xl bg-md-primary text-md-on-primary font-bold text-sm hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {creating ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'Desafiar'}
                </button>
              </div>
              <p className="text-[11px] text-md-on-surface-variant mt-3">
                O desafiante responde primeiro; o oponente recebe as mesmas 5 questões depois.
                Cada acerto vale 5 pontos para o departamento. Desafio expira em 72h.
              </p>
            </section>

            {/* Lista de batalhas */}
            <section className="bg-md-surface-container border border-md-outline-variant rounded-2xl p-5">
              <h2 className="text-lg font-black text-md-on-surface tracking-tight flex items-center gap-2 mb-4">
                <Hourglass size={20} className="text-md-primary" />
                Meus duelos
              </h2>
              {!battles ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="animate-spin text-md-primary" size={26} />
                </div>
              ) : battles.length === 0 ? (
                <p className="text-md-on-surface-variant text-sm text-center py-8">
                  Nenhuma batalha ainda. Lance o primeiro desafio!
                </p>
              ) : (
                <div className="space-y-2.5">
                  {battles.map((b) => {
                    const expired = new Date(b.expiresAt).getTime() < Date.now();
                    const playable = canPlay(b);
                    return (
                      <div
                        key={b.id}
                        className="flex items-center gap-3 rounded-xl border border-md-outline-variant bg-md-surface-container-low px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-md-on-surface truncate">
                            {b.challengerName}
                            <span className="text-md-on-surface-variant font-normal mx-2">vs</span>
                            {b.opponentName}
                          </p>
                          <p className="text-xs text-md-on-surface-variant mt-0.5">
                            {statusLabel(b)}
                            {expired && !b.status.includes('completed') ? ' · expirado' : ''}
                          </p>
                        </div>
                        {b.status === 'completed' ? (
                          b.winnerId ? (
                            <CheckCircle2 size={20} className="text-md-primary shrink-0" />
                          ) : (
                            <XCircle size={20} className="text-md-on-surface-variant shrink-0" />
                          )
                        ) : playable ? (
                          <button
                            onClick={() => setActiveBattleId(b.id)}
                            className="px-4 py-2 rounded-full bg-md-primary text-md-on-primary text-xs font-bold hover:opacity-90 transition shrink-0"
                          >
                            Jogar turno
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Ranking interdepartamental */}
          <div className="lg:col-span-2">
            <LeaderboardCard />
          </div>
        </div>
      </div>

      {/* Arena de duelo (timer 15s + detecção de foco) */}
      {activeBattleId && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-md-surface-dim border border-md-outline-variant rounded-2xl p-6 relative">
            <BattleArena
              battleId={activeBattleId}
              onClose={() => setActiveBattleId(null)}
              onFinished={load}
            />
          </div>
        </div>
      )}
    </main>
  );
}