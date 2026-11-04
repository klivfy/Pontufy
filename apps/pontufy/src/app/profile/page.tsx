'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useStore } from '@/store/useStore';
import { useUserStore } from '@/store/useUserStore';
import { isSoundEnabled, setSoundEnabled } from '@/lib/feedback';
import AchievementsCard from '@/components/profile/AchievementsCard';
import { Loader2, User, Coins, Save, ShieldCheck, Building2, Volume2, VolumeX, LogOut } from 'lucide-react';

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const currentUser = useStore((s) => s.currentUser);
  const { currentPoints } = useUserStore();
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [soundEnabled, setSound] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (session?.user?.name) setName(session.user.name);
    setSound(isSoundEnabled());
  }, [session?.user?.name]);

  const roleLabel =
    currentUser?.role === 'admin_rh' ? 'Administrador RH' : 'Colaborador';

  const handleSaveName = async () => {
    if (!name.trim() || name.trim().length < 2) {
      setMessage({ type: 'error', text: 'Nome deve ter pelo menos 2 caracteres.' });
      return;
    }
    setIsSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/users/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Erro ao salvar.' });
        return;
      }
      setMessage({ type: 'success', text: 'Nome atualizado com sucesso!' });
    } catch {
      setMessage({ type: 'error', text: 'Erro ao salvar.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (status === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-md-surface-dim">
        <Loader2 className="animate-spin text-md-primary" size={36} />
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-20 pt-24 bg-md-surface-dim">
      <div className="max-w-[720px] mx-auto px-6 md:px-8">
        <header className="mb-8">
          <h1 className="text-3xl font-black text-md-on-surface tracking-tight">Meu Perfil</h1>
          <p className="text-md-on-surface-variant mt-1.5 text-sm">Gerencie suas informações pessoais.</p>
        </header>

        <div className="space-y-6">
          {/* Identity card */}
          <section className="bg-md-surface border border-md-outline rounded-xl p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 rounded-full bg-md-primary flex items-center justify-center text-md-on-primary font-black text-xl flex-shrink-0">
                {session?.user?.name?.[0]?.toUpperCase() ?? <User size={28} />}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-md-on-surface truncate">{session?.user?.name}</h2>
                <p className="text-sm text-md-on-surface-variant truncate">{session?.user?.email}</p>
                <span className="inline-flex items-center gap-1.5 mt-1 text-xs font-bold px-2 py-0.5 rounded-full border bg-md-surface-container-low text-md-on-surface border-md-outline-variant">
                  <ShieldCheck size={11} className="text-md-tertiary" />
                  {roleLabel}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-md-surface-container border border-md-outline rounded-lg p-4">
                <div className="flex items-center gap-2 text-md-on-surface-variant text-xs font-bold uppercase tracking-wider mb-1">
                  <Coins size={13} className="text-md-tertiary" /> Saldo de Pontos
                </div>
                <div className="text-2xl font-black text-md-tertiary">{currentPoints}</div>
              </div>
              <div className="bg-md-surface-container border border-md-outline rounded-lg p-4">
                <div className="flex items-center gap-2 text-md-on-surface-variant text-xs font-bold uppercase tracking-wider mb-1">
                  <Building2 size={13} className="text-md-tertiary" /> Empresa
                </div>
                <div className="text-sm font-semibold text-md-on-surface mt-1.5">{session?.user?.tenantId ? 'Conta corporativa' : '—'}</div>
              </div>
            </div>
          </section>

          {/* Edit name */}
          <section className="bg-md-surface border border-md-outline rounded-xl p-6">
            <h3 className="font-bold text-md-on-surface mb-4">Editar Nome</h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome completo"
                className="flex-1 px-4 py-2.5 rounded-lg bg-md-surface-container border border-md-outline text-md-on-surface placeholder:text-md-on-surface-muted focus:outline-none focus:border-md-primary text-sm"
              />
              <button
                type="button"
                onClick={handleSaveName}
                disabled={isSaving}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-bold text-md-on-primary bg-md-primary hover:bg-md-primary-container transition-colors text-sm disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                Salvar
              </button>
            </div>
            {message && (
              <p className={`mt-3 text-sm ${message.type === 'success' ? 'text-md-tertiary' : 'text-md-error'}`}>
                {message.text}
              </p>
            )}
          </section>

          {/* Preferências de feedback sensorial (5.2) */}
          <section className="bg-md-surface border border-md-outline rounded-xl p-6">
            <h3 className="font-bold text-md-on-surface mb-1">Feedback Sonoro</h3>
            <p className="text-sm text-md-on-surface-variant mb-4">
              Sons sutis e vibração háptica ao ganhar pontos, acertar quizzes e concluir cursos.
            </p>
            <button
              type="button"
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                setSound(next);
              }}
              aria-pressed={soundEnabled}
              className={`flex items-center justify-between w-full px-4 py-3 rounded-xl border transition-colors ${
                soundEnabled
                  ? 'bg-md-primary/15 border-md-primary/40 text-md-on-surface'
                  : 'bg-md-surface-container border-md-outline text-md-on-surface-variant'
              }`}
            >
              <span className="flex items-center gap-2 font-medium text-sm">
                {soundEnabled ? <Volume2 size={18} className="text-md-tertiary" /> : <VolumeX size={18} />}
                {soundEnabled ? 'Sons e vibração ativados' : 'Mudo'}
              </span>
              <span
                className={`w-10 h-6 rounded-full transition-colors relative ${
                  soundEnabled ? 'bg-md-primary' : 'bg-md-outline'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-md-surface-container-lowest transition-all ${
                    soundEnabled ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              </span>
            </button>
          </section>

          {/* Conquistas (11.4) */}
          <AchievementsCard />

          {/* Segurança (7.3) — revogação instantânea de sessões */}
          <section className="bg-md-surface border border-md-outline rounded-xl p-6">
            <h3 className="font-bold text-md-on-surface mb-1">Sessões Ativas</h3>
            <p className="text-sm text-md-on-surface-variant mb-4">
              Encerra todas as sessões em outros dispositivos imediatamente (útil se seu
              dispositivo for perdido ou roubado).
            </p>
            <button
              type="button"
              onClick={async () => {
                const res = await fetch('/api/auth/revoke-all', { method: 'POST' });
                if (res.ok) {
                  setMessage({ type: 'success', text: 'Todas as sessões foram encerradas.' });
                } else {
                  setMessage({ type: 'error', text: 'Erro ao encerrar sessões.' });
                }
              }}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-md-on-error-container bg-md-error-container hover:bg-md-error/25 transition-colors text-sm"
            >
              <LogOut size={15} />
              Encerrar sessões em todos os dispositivos
            </button>
          </section>

          <div className="text-center">
            <Link href="/wallet" className="text-sm text-md-on-surface-variant hover:text-md-on-surface transition-colors font-medium">
              ← Ver histórico de pontos na Carteira
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}