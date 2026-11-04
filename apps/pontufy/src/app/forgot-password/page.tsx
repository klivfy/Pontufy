'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import Wordmark from '@/components/brand/Wordmark';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(true);
      } else {
        setError(data.error || 'Erro ao enviar e-mail de recuperação.');
      }
    } catch {
      setError('Erro ao conectar ao servidor.');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <main className="min-h-screen bg-md-surface-dim flex flex-col items-center justify-center px-4 relative">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 60% 40% at 50% 0%, color-mix(in srgb, var(--color-md-primary) 10%, transparent) 0%, transparent 70%)',
          }}
        />

        <div className="md-card-outlined md-elevation-3 p-8 w-full max-w-md mx-auto text-center">
          <Link href="/" className="inline-flex items-center gap-2 text-3xl font-black tracking-tight text-md-on-surface mb-8">
            <Wordmark />
          </Link>

          <CheckCircle2 size={48} className="text-md-tertiary mx-auto mb-4" />
          <h1 className="text-headline-sm font-bold text-md-on-surface mb-2">E-mail enviado!</h1>
          <p className="text-body-md text-md-on-surface-variant mb-6">
            Enviamos um link de recuperação para <strong className="text-md-on-surface">{email}</strong>.
          </p>
          <p className="text-body-sm text-md-on-surface-variant mb-8">
            Verifique sua caixa de entrada (e spam). O link expira em 1 hora.
          </p>

          <button
            onClick={() => router.push('/login')}
            className="md-btn md-btn-filled w-full"
          >
            <ArrowLeft size={18} className="mr-2" />
            Voltar ao login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-md-surface-dim flex flex-col items-center justify-center px-4 relative">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 0%, color-mix(in srgb, var(--color-md-primary) 10%, transparent) 0%, transparent 70%)',
        }}
      />

      <div className="w-full max-w-md">
        <Link href="/" className="inline-flex items-center gap-2 text-3xl font-black tracking-tight text-md-on-surface mb-8">
          <Wordmark />
        </Link>

        <div className="md-card-outlined md-elevation-3 p-8">
          <h1 className="text-headline-sm font-bold text-md-on-surface mb-2 text-center">Recuperar senha</h1>
          <p className="text-body-md text-md-on-surface-variant text-center mb-8">
            Informe seu e-mail corporativo para receber o link de redefinição.
          </p>

          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div
                role="alert"
                className="bg-md-error/10 border border-md-error/30 text-md-error text-body-sm p-3 rounded-xl text-center font-medium"
              >
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="text-label-lg text-md-on-surface-variant mb-1.5 block">
                E-mail corporativo
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant size-5 pointer-events-none" aria-hidden="true" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={isLoading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  placeholder="voce@empresa.com"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="md-btn md-btn-filled w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={20} aria-hidden />
                  Enviando...
                </>
              ) : (
                'Enviar link de recuperação'
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-body-sm text-md-on-surface-variant">
            <Link href="/login" className="font-semibold text-md-primary hover:text-md-primary-container transition-colors flex items-center justify-center gap-1">
              <ArrowLeft size={16} />
              Voltar ao login
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}