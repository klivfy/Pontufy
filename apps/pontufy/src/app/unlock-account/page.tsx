'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

function UnlockContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');

  const unlock = useCallback(async () => {
    if (!token) {
      setStatus('error');
      setError('Link inválido: nenhum token de desbloqueio foi fornecido.');
      return;
    }
    try {
      const res = await fetch('/api/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus('error');
        setError(data.error || 'Falha ao desbloquear a conta.');
        return;
      }
      setStatus('success');
    } catch {
      setStatus('error');
      setError('Erro de conexão. Tente novamente.');
    }
  }, [token]);

  useEffect(() => {
    unlock();
  }, [unlock]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-md-surface-dim px-4">
      <div className="w-full max-w-sm bg-md-surface border border-md-outline rounded-3xl p-8 text-center">
        {status === 'loading' && (
          <>
            <Loader2 size={40} className="animate-spin text-md-primary mx-auto mb-4" />
            <h1 className="text-lg font-bold text-md-on-surface">Desbloqueando sua conta...</h1>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 rounded-full bg-md-tertiary/15 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck size={30} className="text-md-tertiary" />
            </div>
            <h1 className="text-lg font-bold text-md-on-surface">Conta desbloqueada!</h1>
            <p className="text-sm text-md-on-surface-variant mt-2">
              Sua conta foi desbloqueada com sucesso. Já pode entrar novamente.
            </p>
            <Link href="/login" className="block mt-6">
              <Button className="w-full">Ir para o login</Button>
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-16 h-16 rounded-full bg-md-error/15 flex items-center justify-center mx-auto mb-4">
              <XCircle size={30} className="text-md-error" />
            </div>
            <h1 className="text-lg font-bold text-md-on-surface">Não foi possível desbloquear</h1>
            <p className="text-sm text-md-on-surface-variant mt-2">{error}</p>
            <Link href="/login" className="block mt-6">
              <Button variant="tonal" className="w-full">
                Voltar ao login
              </Button>
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function UnlockAccountPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-md-surface-dim" />}>
      <UnlockContent />
    </Suspense>
  );
}