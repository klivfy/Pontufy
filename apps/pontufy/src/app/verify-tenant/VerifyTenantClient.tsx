'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2, MailCheck } from 'lucide-react';

// Página intermediária de confirmação de e-mail (V3).
//
// O link do e-mail aponta para AQUI, não para a API: scanners de e-mail fazem
// prefetch de links e consumiriam o token de uso único antes do clique humano.
// A confirmação só acontece no POST disparado por esta página.

type State = 'idle' | 'loading' | 'success' | 'error';

export default function VerifyTenantClient() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get('token') ?? '', [searchParams]);

  // Estado inicial derivado do token (sem setState síncrono no efeito).
  const [state, setState] = useState<State>(() => (token ? 'loading' : 'error'));
  const [message, setMessage] = useState(() =>
    token ? '' : 'Link inválido: token ausente.',
  );

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/tenants/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));

        if (cancelled) return;

        if (res.ok) {
          setState('success');
          setMessage(data?.message ?? 'E-mail confirmado. Sua conta está ativa.');
        } else {
          setState('error');
          setMessage(data?.error ?? 'Não foi possível confirmar o e-mail.');
        }
      } catch {
        if (!cancelled) {
          setState('error');
          setMessage('Falha de conexão. Tente novamente.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="min-h-screen bg-md-surface-dim flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-md-surface rounded-2xl border border-md-outline p-8 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-md-primary/10 text-md-primary">
          {state === 'success' ? (
            <CheckCircle2 size={32} />
          ) : state === 'error' ? (
            <XCircle size={32} className="text-red-500" />
          ) : state === 'loading' ? (
            <Loader2 size={32} className="animate-spin" />
          ) : (
            <MailCheck size={32} />
          )}
        </div>

        <h1 className="text-2xl font-black text-md-on-surface">
          {state === 'success'
            ? 'E-mail confirmado'
            : state === 'error'
              ? 'Não foi possível confirmar'
              : 'Confirmando seu e-mail'}
        </h1>

        <p className="mt-3 text-sm text-md-on-surface-variant">
          {state === 'loading' || state === 'idle'
            ? 'Estamos validando o link. Isso leva um segundo.'
            : message}
        </p>

        {state === 'success' && (
          <Link
            href="/login"
            className="mt-8 inline-flex w-full items-center justify-center rounded-xl bg-md-primary px-6 py-3 font-bold text-white"
          >
            Entrar na plataforma
          </Link>
        )}

        {state === 'error' && (
          <div className="mt-8 space-y-3">
            <Link
              href="/forgot-password"
              className="inline-flex w-full items-center justify-center rounded-xl border border-md-outline px-6 py-3 font-bold text-md-on-surface"
            >
              Reenviar / recuperar acesso
            </Link>
            <Link href="/login" className="block text-sm text-md-primary">
              Voltar para o login
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
