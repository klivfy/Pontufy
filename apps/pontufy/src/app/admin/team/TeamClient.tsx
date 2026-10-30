'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Loader2,
  UserPlus,
  Copy,
  Check,
  XCircle,
  Users,
  Mail,
  ArrowLeft,
} from 'lucide-react';

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
  pointsBalance: number;
  createdAt: string;
}

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  signupUrl: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin_rh: 'Administrador',
  employee: 'Colaborador',
  guest: 'Convidado',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  accepted: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  expired: 'bg-red-500/10 text-red-400 border-red-500/20',
};

function statusLabel(status: string): string {
  if (status === 'pending') return 'Pendente';
  if (status === 'accepted') return 'Aceito';
  return 'Expirado';
}

export default function TeamClient() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/invitations', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setUsers(data.users ?? []);
          setInvitations(data.invitations ?? []);
        } else {
          setError(data.error || 'Erro ao carregar equipe.');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Erro ao conectar ao servidor.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role: inviteRole }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setEmail('');
        setLastInviteUrl(data.invitation.signupUrl);
        setReloadKey((k) => k + 1);
      } else {
        setError(data.error || 'Erro ao criar convite.');
      }
    } catch {
      setError('Erro ao conectar ao servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setError('');
    try {
      const res = await fetch('/api/invitations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setReloadKey((k) => k + 1);
      } else {
        const data = await res.json();
        setError(data.error || 'Erro ao revogar convite.');
      }
    } catch {
      setError('Erro ao conectar ao servidor.');
    }
  };

  const copyLink = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError('Não foi possível copiar o link.');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors mb-2"
            >
              <ArrowLeft size={15} /> Voltar ao painel
            </Link>
            <h1 className="text-2xl font-bold text-white">Equipe</h1>
            <p className="text-sm text-gray-500 mt-1">
              Convide colaboradores e gerencie o acesso à plataforma
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg text-center font-medium">
            {error}
          </div>
        )}

        {/* ── Convite ─────────────────────────────────────────────────── */}
        <section className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide mb-4 flex items-center gap-2">
            <UserPlus size={16} className="text-emerald-400" /> Convidar colaborador
          </h2>

          <form className="flex flex-col sm:flex-row gap-3" onSubmit={handleInvite}>
            <div className="flex-1 relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@empresa.com"
                className="w-full pl-10 pr-4 py-3 bg-[#1f1f1f] border border-[#2a2a2a] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 text-sm transition-colors"
              />
            </div>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="px-4 py-3 bg-[#1f1f1f] border border-[#2a2a2a] rounded-lg text-white focus:outline-none focus:border-emerald-500 text-sm transition-colors"
            >
              <option value="employee">Colaborador</option>
              <option value="admin_rh">Administrador</option>
            </select>
            <button
              type="submit"
              disabled={submitting}
              className="flex justify-center items-center gap-2 px-6 py-3 rounded-full text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="animate-spin" size={16} /> : <UserPlus size={16} />}
              Convidar
            </button>
          </form>

          {lastInviteUrl && (
            <div className="mt-4 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
              <p className="text-xs text-emerald-400 font-medium break-all flex-1">
                Link do convite gerado — envie por WhatsApp ou e-mail
              </p>
              <button
                type="button"
                onClick={() => copyLink('last', lastInviteUrl)}
                className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors shrink-0"
              >
                {copiedId === 'last' ? <Check size={14} /> : <Copy size={14} />}
                {copiedId === 'last' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          )}
        </section>

        {/* ── Convites pendentes ──────────────────────────────────────── */}
        <section className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide mb-4 flex items-center gap-2">
            <Mail size={16} className="text-emerald-400" /> Convites
          </h2>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-gray-600" size={22} />
            </div>
          ) : invitations.length === 0 ? (
            <p className="text-sm text-gray-600 text-center py-6">
              Nenhum convite enviado ainda.
            </p>
          ) : (
            <div className="space-y-2.5">
              {invitations.map((invite) => {
                const isPending = invite.status === 'pending';
                const isExpired = invite.expiresAt < new Date().toISOString();
                const status = isPending && isExpired ? 'expired' : invite.status;
                return (
                  <div
                    key={invite.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-3 bg-[#1f1f1f] border border-[#2a2a2a] rounded-xl p-4"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{invite.email}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {ROLE_LABELS[invite.role] ?? invite.role} · Expira em{' '}
                        {new Date(invite.expiresAt).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-bold px-3 py-1 rounded-full border ${STATUS_STYLES[status] ?? STATUS_STYLES.pending}`}
                    >
                      {statusLabel(status)}
                    </span>
                    {isPending && !isExpired && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copyLink(invite.id, invite.signupUrl)}
                          className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          {copiedId === invite.id ? <Check size={14} /> : <Copy size={14} />}
                          {copiedId === invite.id ? 'Copiado' : 'Copiar link'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRevoke(invite.id)}
                          className="flex items-center gap-1.5 text-xs font-bold text-red-400 hover:text-red-300 transition-colors"
                        >
                          <XCircle size={14} /> Revogar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Membros ─────────────────────────────────────────────────── */}
        <section className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide mb-4 flex items-center gap-2">
            <Users size={16} className="text-emerald-400" /> Membros da equipe
          </h2>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-gray-600" size={22} />
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-gray-600 text-center py-6">
              Nenhum membro cadastrado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-[#2a2a2a]">
                    <th className="pb-3 pr-4 font-semibold">Nome</th>
                    <th className="pb-3 pr-4 font-semibold">Email</th>
                    <th className="pb-3 pr-4 font-semibold">Perfil</th>
                    <th className="pb-3 font-semibold">Pontos</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b border-[#1f1f1f] last:border-0">
                      <td className="py-3 pr-4 text-white font-medium whitespace-nowrap">
                        {user.name}
                      </td>
                      <td className="py-3 pr-4 text-gray-400">{user.email}</td>
                      <td className="py-3 pr-4">
                        <span className="text-xs font-bold px-3 py-1 rounded-full border border-[#2a2a2a] bg-[#1f1f1f] text-gray-300">
                          {ROLE_LABELS[user.role] ?? user.role}
                        </span>
                      </td>
                      <td className="py-3 text-emerald-400 font-bold">{user.pointsBalance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}