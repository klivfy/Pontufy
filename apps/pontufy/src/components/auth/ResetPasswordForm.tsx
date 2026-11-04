'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Eye, EyeOff, Lock, ArrowLeft, CheckCircle2 } from 'lucide-react';
import Wordmark from '@/components/brand/Wordmark';

export function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [tokenValid, setTokenValid] = useState(true);

  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setTokenValid(false);
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Token inválido ou ausente.');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    if (password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccess(true);
      } else {
        setError(data.error || 'Erro ao redefinir a senha.');
      }
    } catch {
      setError('Erro ao conectar ao servidor.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!tokenValid) {
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

          <div className="text-md-error mb-4" style={{fontSize: '48px'}}>⚠️</div>
          <h1 className="text-headline-sm font-bold text-md-on-surface mb-2">Link inválido</h1>
          <p className="text-body-md text-md-on-surface-variant mb-6">
            Este link de recuperação é inválido ou expirou.
          </p>
          <button
            onClick={() => router.push('/forgot-password')}
            className="md-btn md-btn-filled w-full"
          >
            <ArrowLeft size={18} className="mr-2" />
            Solicitar novo link
          </button>
        </div>
      </main>
    );
  }

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
          <h1 className="text-headline-sm font-bold text-md-on-surface mb-2">Senha redefinida!</h1>
          <p className="text-body-md text-md-on-surface-variant mb-8">
            Sua senha foi alterada com sucesso. Agora você pode acessar sua conta.
          </p>

          <button
            onClick={() => router.push('/login')}
            className="md-btn md-btn-filled w-full"
          >
            <ArrowLeft size={18} className="mr-2" />
            Ir para o login
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
          <h1 className="text-headline-sm font-bold text-md-on-surface mb-2 text-center">Redefinir senha</h1>
          <p className="text-body-md text-md-on-surface-variant text-center mb-8">
            Crie uma nova senha segura para sua conta.
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
              <label htmlFor="password" className="text-label-lg text-md-on-surface-variant mb-1.5 block">
                Nova senha
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant size-5 pointer-events-none" aria-hidden="true" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  disabled={isLoading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-14 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  placeholder="Mínimo 8 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-md-on-surface-variant hover:text-md-on-surface transition-colors"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="text-label-lg text-md-on-surface-variant mb-1.5 block">
                Confirmar nova senha
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant size-5 pointer-events-none" aria-hidden="true" />
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  disabled={isLoading}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  placeholder="Confirme a nova senha"
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
                  Redefinindo...
                </>
              ) : (
                'Redefinir senha'
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