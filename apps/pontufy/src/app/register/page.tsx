'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Eye, EyeOff, CheckCircle2, Building2, Mail, Lock, User } from 'lucide-react';
import { AuthDivider, GoogleButton, googleAuthErrorMessage } from '@/components/auth/GoogleButton';
import Wordmark from '@/components/brand/Wordmark';

interface InvitationInfo {
  email: string;
  role: string;
  companyName: string;
  expiresAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin_rh: 'Administrador',
  employee: 'Colaborador',
  guest: 'Convidado',
};

function RegisterForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const googleError = googleAuthErrorMessage(searchParams.get('error'));
  const router = useRouter();

  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [inviteLoading, setInviteLoading] = useState(true);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    fetch(`/api/invitations/accept?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.success) {
          setInvitation(data);
        } else {
          setInviteError(data.error || 'Convite inválido.');
        }
      })
      .catch(() => {
        if (!cancelled) setInviteError('Erro ao validar o convite.');
      })
      .finally(() => {
        if (!cancelled) setInviteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return (
      <div className="md-card-outlined md-elevation-3 p-8 text-center">
        <Link href="/" className="inline-flex items-center gap-2 text-3xl font-black tracking-tight text-md-on-surface mb-6">
          <Wordmark />
        </Link>
        <div className="text-md-error mb-4" style={{fontSize: '48px'}}>📨</div>
        <h1 className="text-headline-sm font-bold text-md-on-surface mb-2">Convite necessário</h1>
        <p className="text-body-md text-md-on-surface-variant mb-6">
          Para criar uma conta, você precisa de um convite do gestor da sua empresa.
        </p>
        {googleError && (
          <div
            role="alert"
            className="bg-md-error/10 border border-md-error/30 text-md-error text-body-sm p-3 rounded-xl text-center font-medium mb-4"
          >
            {googleError}
          </div>
        )}
        <GoogleButton intent="login" label="Cadastrar com o Google" />
        <AuthDivider />
        <Link href="/register/tenant" className="md-btn md-btn-filled w-full mb-3">
          <Building2 size={18} className="mr-2" />
          Cadastrar minha empresa
        </Link>
        <Link href="/login" className="text-label-lg text-md-primary hover:text-md-primary-container transition-colors inline-block">
          Já tenho uma conta
        </Link>
      </div>
    );
  }

  if (inviteError) {
    return (
      <div className="md-card-outlined md-elevation-3 p-8 text-center">
        <Link href="/" className="inline-flex items-center gap-2 text-3xl font-black tracking-tight text-md-on-surface mb-6">
          <Wordmark />
        </Link>
        <div className="text-md-error mb-4" style={{fontSize: '48px'}}>⚠️</div>
        <h1 className="text-headline-sm font-bold text-md-on-surface mb-2">Convite indisponível</h1>
        <p className="text-body-md text-md-on-surface-variant mb-4">{inviteError}</p>
        <Link href="/login" className="text-label-lg text-md-primary hover:text-md-primary-container transition-colors inline-block">
          Ir para o login
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="md-card-outlined md-elevation-3 p-8 text-center">
        <Link href="/" className="inline-flex items-center gap-2 text-3xl font-black tracking-tight text-md-on-surface mb-6">
          <Wordmark />
        </Link>
        <CheckCircle2 size={48} className="text-md-tertiary mx-auto mb-4" />
        <h1 className="text-headline-sm font-bold text-md-on-surface mb-2">Conta criada com sucesso!</h1>
        <p className="text-body-md text-md-on-surface-variant mb-6">Agora você já pode acessar a plataforma.</p>
        <button
          onClick={() => router.push('/login')}
          className="md-btn md-btn-filled w-full"
        >
          Ir para o login
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

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
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: name.trim(), password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccess(true);
      } else {
        setError(data.error || 'Erro ao criar conta.');
      }
    } catch {
      setError('Erro ao conectar ao servidor.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="md-card-outlined md-elevation-3 p-8">
      <form className="space-y-5" onSubmit={handleSubmit}>
        <Link href="/" className="inline-flex items-center gap-2 text-3xl font-black tracking-tight text-md-on-surface mb-4 block text-center">
          <Wordmark />
        </Link>

        <div className="text-center mb-6">
          <h1 className="text-headline-sm font-bold text-md-on-surface mb-2">Criar conta</h1>
          <p className="text-body-md text-md-on-surface-variant">Complete seus dados para começar</p>
        </div>

        {inviteLoading && (
          <div className="flex items-center justify-center gap-2 text-md-on-surface-variant text-body-sm py-2">
            <Loader2 className="animate-spin" size={16} /> Validando convite...
          </div>
        )}

        {invitation && (
          <div className="p-4 bg-md-surface-container-high border border-md-outline rounded-xl">
            <div className="flex items-center gap-2">
              <Building2 size={16} className="text-md-tertiary" />
              <span className="text-body-md font-semibold text-md-on-surface">{invitation.companyName}</span>
            </div>
            <p className="text-body-sm text-md-on-surface-variant mt-1.5">
              {invitation.email} · {ROLE_LABELS[invitation.role] ?? invitation.role}
            </p>
          </div>
        )}

        {(error || googleError) && (
          <div
            role="alert"
            className="bg-md-error/10 border border-md-error/30 text-md-error text-body-sm p-3 rounded-xl text-center font-medium"
          >
            {error || googleError}
          </div>
        )}

        <div>
          <label htmlFor="name" className="text-label-lg text-md-on-surface-variant mb-1.5 block">
            Nome completo
          </label>
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant size-5 pointer-events-none" aria-hidden="true" />
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Maria Silva"
              className="w-full pl-12 pr-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="text-label-lg text-md-on-surface-variant mb-1.5 block">
            Criar senha
          </label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant size-5 pointer-events-none" aria-hidden="true" />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="w-full pl-12 pr-14 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-4 flex items-center text-md-on-surface-variant hover:text-md-on-surface transition-colors"
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="text-label-lg text-md-on-surface-variant mb-1.5 block">
            Confirmar senha
          </label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant size-5 pointer-events-none" aria-hidden="true" />
            <input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
              placeholder="Confirme a senha"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="md-btn md-btn-filled w-full mt-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="animate-spin" size={20} /> Criando conta...
            </>
          ) : (
            'Criar minha conta'
          )}
        </button>

        <AuthDivider />
        <GoogleButton intent="invite" token={token} label="Criar conta com o Google" />

        <p className="text-center text-body-sm text-md-on-surface-variant pt-2">
          Já tem conta?{' '}
          <Link href="/login" className="font-semibold text-md-primary hover:text-md-primary-container transition-colors">
            Fazer login
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-md-surface-dim flex flex-col items-center justify-center px-4 relative">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 60% 40% at 50% 0%, color-mix(in srgb, var(--color-md-primary) 10%, transparent) 0%, transparent 70%)',
        }}
      />

      <div className="w-full max-w-md">
        <Suspense fallback={<div className="text-center text-md-on-surface-variant py-8">Carregando...</div>}>
          <RegisterForm />
        </Suspense>
      </div>
    </main>
  );
}