'use client';

import { useState } from 'react';
import { Loader2, Save, Zap, Edit2, CreditCard, Users, FileText, Calendar } from 'lucide-react';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  aiCredits: number;
  subscriptionStatus: string | null;
  trialEndsAt: Date | null;
  createdAt: Date;
  _count: { users: number; courses: number };
}

const PLAN_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  trial: { label: 'Trial', bg: 'bg-md-highlight/10', text: 'text-md-on-highlight', border: 'border-md-highlight/30' },
  starter: { label: 'Starter', bg: 'bg-md-primary-container/10', text: 'text-md-on-primary-container', border: 'border-md-primary-container/30' },
  enterprise: { label: 'Enterprise', bg: 'bg-md-tertiary-container/10', text: 'text-md-on-tertiary-container', border: 'border-md-tertiary-container/30' },
};

function planConfig(plan: string) {
  return PLAN_CONFIG[plan] ?? { label: plan, bg: 'bg-md-surface-container-high', text: 'text-md-on-surface-variant', border: 'border-md-outline' };
}

export default function TenantsConsole({ initialTenants }: { initialTenants: TenantRow[] }) {
  const [tenants, setTenants] = useState<TenantRow[]>(initialTenants);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<number>(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleSave = async (tenantId: string) => {
    setError('');
    setSavingId(tenantId);
    try {
      const res = await fetch(`/api/superadmin/tenants/${tenantId}/credits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiCredits: draft }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setTenants((prev) =>
          prev.map((t) =>
            t.id === tenantId ? { ...t, aiCredits: data.tenant.aiCredits } : t,
          ),
        );
        setEditingId(null);
      } else {
        setError(data.error || 'Erro ao ajustar créditos.');
      }
    } catch {
      setError('Erro ao conectar ao servidor.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="md-card-outlined md-elevation-1 p-6 overflow-hidden">
      <h2 className="text-label-lg font-bold text-md-on-surface uppercase tracking-wider mb-5 flex items-center gap-2">
        <Zap size={18} className="text-md-primary" /> Empresas
      </h2>

      {error && (
        <div className="mb-5 p-3 bg-md-error/10 border border-md-error/30 text-md-error text-body-sm rounded-xl text-center font-medium">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-label-sm text-md-on-surface-variant uppercase tracking-wider border-b border-md-outline">
              <th className="pb-3 pr-4 font-semibold">Empresa</th>
              <th className="pb-3 pr-4 font-semibold">Plano</th>
              <th className="pb-3 pr-4 font-semibold">Assinatura</th>
              <th className="pb-3 pr-4 font-semibold text-center">
                <Users size={14} className="inline mx-auto" />
              </th>
              <th className="pb-3 pr-4 font-semibold text-center">
                <FileText size={14} className="inline mx-auto" />
              </th>
              <th className="pb-3 pr-4 font-semibold text-center">
                <Calendar size={14} className="inline mx-auto" />
              </th>
              <th className="pb-3 font-semibold">Créditos IA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-md-outline">
            {tenants.map((tenant) => {
              const isEditing = editingId === tenant.id;
              const config = planConfig(tenant.plan);
              return (
                <tr key={tenant.id} className="align-top transition-colors hover:bg-md-surface-container-high/50">
                  <td className="py-4 pr-4">
                    <p className="text-md-on-surface font-medium">{tenant.name}</p>
                    <p className="text-body-sm text-md-on-surface-variant font-mono">{tenant.slug}</p>
                  </td>
                  <td className="py-4 pr-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-label-sm font-semibold ${config.bg} ${config.text} ${config.border}`}>
                      {config.label}
                    </span>
                  </td>
                  <td className="py-4 pr-4 text-md-on-surface-variant">{tenant.subscriptionStatus ?? '—'}</td>
                  <td className="py-4 pr-4 text-center text-md-on-surface-variant">{tenant._count.users}</td>
                  <td className="py-4 pr-4 text-center text-md-on-surface-variant">{tenant._count.courses}</td>
                  <td className="py-4 pr-4 text-center text-md-on-surface-variant whitespace-nowrap">
                    {tenant.trialEndsAt
                      ? new Date(tenant.trialEndsAt).toLocaleDateString('pt-BR')
                      : '—'}
                  </td>
                  <td className="py-4">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-2">
                        <input
                          type="number"
                          min={0}
                          value={draft}
                          onChange={(e) => setDraft(Number.parseInt(e.target.value, 10) || 0)}
                          className="w-24 px-3 py-2 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface text-body-sm focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20"
                        />
                        <button
                          type="button"
                          onClick={() => handleSave(tenant.id)}
                          disabled={savingId === tenant.id}
                          className="md-btn md-btn-filled text-label-sm"
                        >
                          {savingId === tenant.id ? (
                            <Loader2 className="animate-spin" size={14} />
                          ) : (
                            <Save size={14} />
                          )}
                          Salvar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(tenant.id);
                          setDraft(tenant.aiCredits);
                        }}
                        className="flex items-center gap-1 text-md-primary font-bold hover:text-md-primary-container transition-colors"
                      >
                        <CreditCard size={16} />
                        {tenant.aiCredits}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}