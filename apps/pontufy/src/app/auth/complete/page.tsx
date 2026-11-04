'use client';

import { Suspense, useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

function CompleteGoogleSession() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ticket = searchParams.get('ticket');
    const nextParam = searchParams.get('next');
    const next =
      nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')
        ? nextParam
        : '/dashboard';

    if (!ticket) {
      router.replace('/login?error=google_denied');
      return;
    }

    let cancelled = false;
    signIn('google-bridge', { ticket, redirect: false })
      .then((res: { error?: string | null } | undefined) => {
        if (cancelled) return;
        if (res?.error) {
          setError('Não foi possível concluir o login com o Google.');
          router.replace('/login?error=google_denied');
          return;
        }
        router.replace(next);
        router.refresh();
      })
      .catch(() => {
        if (!cancelled) {
          setError('Erro ao conectar ao servidor.');
          router.replace('/login?error=google_unavailable');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <div className="md-card-outlined md-elevation-3 p-8 w-full max-w-md text-center">
      <Loader2 className="animate-spin mx-auto mb-4 text-md-primary" size={28} aria-hidden />
      <p className="text-body-md text-md-on-surface-variant">
        {error ?? 'Concluindo o acesso com o Google...'}
      </p>
    </div>
  );
}

export default function AuthCompletePage() {
  return (
    <main className="min-h-screen bg-md-surface-dim flex flex-col items-center justify-center px-4">
      <Suspense
        fallback={
          <div className="md-card-outlined md-elevation-3 p-8 w-full max-w-md text-center">
            <Loader2 className="animate-spin mx-auto text-md-primary" size={28} aria-hidden />
          </div>
        }
      >
        <CompleteGoogleSession />
      </Suspense>
    </main>
  );
}
