'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CreditCard, Loader2 } from 'lucide-react';

type BillingSnapshot = {
  name: string;
  plan: string;
  trialEndsAt: string | null;
  aiCredits: number;
  stripeCustomerId: string | null;
  subscriptionStatus: string | null;
  contractStatus: string;
};

export default function BillingClient() {
  const searchParams = useSearchParams();
  const status = searchParams.get('status');
  const [data, setData] = useState<BillingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'starter' | 'enterprise' | 'portal' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/billing', { cache: 'no-store' })
      .then((r) => r.json())
      .then((payload) => {
        if (payload.error) setError(payload.error);
        else setData(payload);
      })
      .catch(() => setError('Não foi possível carregar a cobrança.'))
      .finally(() => setLoading(false));
  }, []);

  async function startCheckout(plan: 'starter' | 'enterprise') {
    setBusy(plan);
    setError('');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.url) {
        setError(payload.error || 'Não foi possível iniciar o checkout.');
        return;
      }
      window.location.href = payload.url;
    } catch {
      setError('Falha de rede ao iniciar o checkout.');
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy('portal');
    setError('');
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const payload = await res.json();
      if (!res.ok || !payload.url) {
        setError(payload.error || 'Não foi possível abrir o portal.');
        return;
      }
      window.location.href = payload.url;
    } catch {
      setError('Falha de rede ao abrir o portal.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="animate-spin text-md-primary" size={40} />
      </div>
    );
  }

  const trialLabel = data?.trialEndsAt
    ? new Date(data.trialEndsAt).toLocaleDateString('pt-BR')
    : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <div className="flex items-center gap-2 mb-1">
          <CreditCard className="text-md-primary" size={22} />
          <h1 className="text-title-lg font-bold text-md-on-surface">Assinatura</h1>
        </div>
        <p className="text-body-md text-md-on-surface-variant">
          Plano, trial e créditos de IA da {data?.name ?? 'empresa'}.
        </p>
      </header>

      {status === 'success' && (
        <p className="text-body-md text-md-on-primary-container bg-md-primary-container/20 border border-md-primary/20 rounded-xl px-4 py-3">
          Assinatura confirmada. Os créditos serão atualizados em instantes.
        </p>
      )}
      {status === 'canceled' && (
        <p className="text-body-md text-md-on-surface-variant bg-md-surface-container border border-md-outline rounded-xl px-4 py-3">
          Checkout cancelado. Nenhum débito foi feito.
        </p>
      )}
      {error && (
        <p className="text-body-md text-md-error bg-md-error/10 border border-md-error/20 rounded-xl px-4 py-3">{error}</p>
      )}

      <section className="md-card-outlined md-elevation-1 p-6 space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-body-md">
          <div>
            <dt className="text-md-on-surface-variant">Plano</dt>
            <dd className="font-semibold text-md-on-surface capitalize">{data?.plan ?? 'trial'}</dd>
          </div>
          <div>
            <dt className="text-md-on-surface-variant">Status</dt>
            <dd className="font-semibold text-md-on-surface">{data?.subscriptionStatus ?? data?.contractStatus ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-md-on-surface-variant">Créditos de IA</dt>
            <dd className="font-semibold text-md-on-surface">{data?.aiCredits ?? 0}</dd>
          </div>
          <div>
            <dt className="text-md-on-surface-variant">Trial até</dt>
            <dd className="font-semibold text-md-on-surface">{trialLabel ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => startCheckout('starter')}
          disabled={busy !== null}
          className="px-5 py-2.5 rounded-full text-sm font-bold text-white bg-md-primary hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'starter' ? 'Abrindo…' : 'Assinar Starter'}
        </button>
        <button
          type="button"
          onClick={() => startCheckout('enterprise')}
          disabled={busy !== null}
          className="px-5 py-2.5 rounded-full text-sm font-bold text-md-on-surface bg-md-surface-container-high hover:bg-md-surface-container disabled:opacity-50"
        >
          {busy === 'enterprise' ? 'Abrindo…' : 'Assinar Enterprise'}
        </button>
        {data?.stripeCustomerId && (
          <button
            type="button"
            onClick={openPortal}
            disabled={busy !== null}
            className="px-5 py-2.5 rounded-full text-sm font-bold text-md-on-surface border border-md-outline hover:bg-md-surface-container-high disabled:opacity-50"
          >
            {busy === 'portal' ? 'Abrindo…' : 'Gerenciar no Stripe'}
          </button>
        )}
      </div>
    </div>
  );
}
