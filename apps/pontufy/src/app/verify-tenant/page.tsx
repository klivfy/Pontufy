import { Suspense } from 'react';
import type { Metadata } from 'next';
import VerifyTenantClient from './VerifyTenantClient';

// `useSearchParams()` exige boundary de Suspense para a página poder ser
// pré-renderizada. O shell é estático; a confirmação roda no cliente, quando
// o token do e-mail está disponível na URL.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Confirmar e-mail | Pontufy',
  description: 'Confirme o e-mail para ativar sua conta na Pontufy.',
  robots: { index: false, follow: false },
};

export default function VerifyTenantPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-md-surface-dim flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-md-outline bg-md-surface p-8 text-center">
            <div className="mx-auto mb-6 h-16 w-16 animate-pulse rounded-full bg-md-primary/10" />
            <p className="text-sm text-md-on-surface-variant">Carregando confirmação…</p>
          </div>
        </main>
      }
    >
      <VerifyTenantClient />
    </Suspense>
  );
}
