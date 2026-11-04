'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Eye, EyeOff, Mail, Lock } from 'lucide-react';
import { AuthDivider, GoogleButton, googleAuthErrorMessage } from '@/components/auth/GoogleButton';
import Wordmark from '@/components/brand/Wordmark';

function errorMessage(error: string | null): string | null {
  if (!error) return null;
  const googleMessage = googleAuthErrorMessage(error);
  if (googleMessage) return googleMessage;
  switch (error) {
    case 'CredentialsSignin':
    case 'credentials':
    case 'Credentials':
      return 'Email ou senha incorretos. Verifique e tente novamente.';
    case 'Configuration':
      return 'Falha de configuração da autenticação. Contate o administrador.';
    default:
      return 'Não foi possível entrar. Tente novamente.';
  }
}

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectError = errorMessage(searchParams.get('error'));
  const callbackUrlParam = searchParams.get('callbackUrl');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (res?.error) {
        setError(errorMessage(res.error));
        return;
      }

      const callbackUrl =
        callbackUrlParam && callbackUrlParam.startsWith('/') && !callbackUrlParam.startsWith('//')
          ? callbackUrlParam
          : '/dashboard';

      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError('Erro ao conectar ao servidor. Verifique sua conexão e tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const showError = error ?? redirectError;

  return (
    <div className="md-card-outlined md-elevation-3 p-8 w-full max-w-md mx-auto">
      <div className="text-center mb-8">
        <Link href="/" className="inline-flex items-center gap-2 text-3xl font-black tracking-tight text-md-on-surface mb-6">
          <Wordmark />
        </Link>
        <h1 className="text-headline-sm font-bold text-md-on-surface mb-2">Entrar</h1>
        <p className="text-body-md text-md-on-surface-variant">Acesse sua conta corporativa</p>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit} noValidate={false}>
        {showError && (
          <div
            role="alert"
            className="bg-md-error/10 border border-md-error/30 text-md-error text-body-sm p-3 rounded-xl text-center font-medium"
          >
            {showError}
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

        <div>
          <label htmlFor="password" className="text-label-lg text-md-on-surface-variant mb-1.5 block">
            Senha
          </label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant size-5 pointer-events-none" aria-hidden="true" />
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              disabled={isLoading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-12 pr-14 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="••••••••"
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

        <div className="flex justify-end pt-1">
          <Link
            href="/forgot-password"
            className="text-label-lg text-md-primary hover:text-md-primary-container transition-colors"
          >
            Esqueceu a senha?
          </Link>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="md-btn md-btn-filled w-full mt-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="animate-spin" size={20} aria-hidden />
              Entrando...
            </>
          ) : (
            'Entrar'
          )}
        </button>
      </form>

      <AuthDivider />
      <GoogleButton
        intent="login"
        next={
          callbackUrlParam && callbackUrlParam.startsWith('/') && !callbackUrlParam.startsWith('//')
            ? callbackUrlParam
            : '/dashboard'
        }
      />

      <p className="mt-6 text-center text-body-sm text-md-on-surface-variant">
        Recebeu um convite?{' '}
        <Link href="/register" className="font-semibold text-md-primary hover:text-md-primary-container transition-colors">
          Criar minha conta
        </Link>
      </p>
    </div>
  );
}