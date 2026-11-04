'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldOff, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';

interface BlockedIp {
  ip: string;
  reason: string;
  blockedAt: string;
  expiresAt: string;
}

export default function SecurityIpsConsole() {
  const [ips, setIps] = useState<BlockedIp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnblocking, setIsUnblocking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/superadmin/security/ips');
      const data = await res.json();
      setIps(data.ips ?? []);
    } catch {
      setIps([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleUnblock = async (ip: string) => {
    setIsUnblocking(ip);
    try {
      await fetch('/api/superadmin/security/ips', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip }),
      });
      await load();
    } finally {
      setIsUnblocking(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-md-primary" size={28} />
      </div>
    );
  }

  if (ips.length === 0) {
    return (
      <div className="md-card-outlined md-elevation-1 p-10 text-center">
        <ShieldCheck size={36} className="text-md-tertiary mx-auto mb-3" />
        <p className="text-title-lg font-bold text-md-on-surface">Nenhum IP bloqueado</p>
        <p className="text-body-md text-md-on-surface-variant mt-1">
          O sistema bloqueia automaticamente IPs com atividade suspeita de força bruta.
        </p>
      </div>
    );
  }

  return (
    <section className="md-card-outlined md-elevation-1 overflow-hidden">
      <div className="p-5 border-b border-md-outline bg-md-surface-container-high/50">
        <h2 className="text-title-lg font-bold text-md-on-surface flex items-center gap-2">
          <ShieldAlert size={20} className="text-md-secondary" />
          IPs Bloqueados
        </h2>
        <p className="text-body-sm text-md-on-surface-variant mt-1">
          Monitoramento de força bruta e abuso — IPs bloqueados automaticamente pelo sistema.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-label-sm text-md-on-surface-variant uppercase tracking-wider border-b border-md-outline bg-md-surface-container-high/50">
              <th className="px-4 py-3 font-semibold">IP</th>
              <th className="px-4 py-3 font-semibold">Motivo</th>
              <th className="px-4 py-3 font-semibold">Bloqueado em</th>
              <th className="px-4 py-3 font-semibold">Expira</th>
              <th className="px-4 py-3 font-semibold text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-md-outline">
            {ips.map((entry) => (
              <tr key={entry.ip} className="transition-colors hover:bg-md-surface-container-high/50">
                <td className="px-4 py-3 font-mono text-md-on-surface">{entry.ip}</td>
                <td className="px-4 py-3 text-md-on-surface-variant">{entry.reason}</td>
                <td className="px-4 py-3 text-md-on-surface-variant">
                  {entry.blockedAt ? new Date(entry.blockedAt).toLocaleString('pt-BR') : '—'}
                </td>
                <td className="px-4 py-3 text-md-on-surface-variant">
                  {entry.expiresAt ? new Date(entry.expiresAt).toLocaleString('pt-BR') : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleUnblock(entry.ip)}
                    disabled={isUnblocking === entry.ip}
                    className="md-btn md-btn-text text-md-error hover:bg-md-error/10"
                  >
                    <ShieldOff size={14} />
                    {isUnblocking === entry.ip ? '...' : 'Desbloquear'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}