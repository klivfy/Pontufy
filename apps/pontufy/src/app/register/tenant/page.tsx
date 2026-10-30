'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Eye, EyeOff, CheckCircle2, Building2, User, Mail, Lock, ArrowLeft } from 'lucide-react';
import { AuthDivider, GoogleButton, googleAuthErrorMessage } from '@/components/auth/GoogleButton';

const SECTORS = [
  { value: 'tech', label: 'Tecnologia' },
  { value: 'health', label: 'Saúde' },
  { value: 'retail', label: 'Varejo' },
  { value: 'industry', label: 'Indústria' },
] as const;

function TenantRegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const googleError = googleAuthErrorMessage(searchParams.get('error'));

  const [companyName, setCompanyName] = useState('');
  const [sector, setSector] = useState<string>('tech');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

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
      const res = await fetch('/api/tenants/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          sector,
          adminName: adminName.trim(),
          adminEmail: adminEmail.trim(),
          adminPassword: password,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccess(true);
      } else {
        setError(data.error || 'Erro ao criar a empresa.');
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
            background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(92,65,82,0.12) 0%, transparent 70%)',
          }}
        />

        <div className="md-card-outlined md-elevation-3 p-8 w-full max-w-md mx-auto text-center">
          <Link href="/" className="inline-flex items-center gap-2 text-3xl font-black tracking-tight text-white mb-8">
            <span className="text-md-primary">Pontu</span>fy
          </Link>

          <CheckCircle2 size={48} className="text-md-tertiary mx-auto mb-4" />
          <h1 className="text-headline-sm font-bold text-md-on-surface mb-2">Empresa criada com sucesso!</h1>
          <p className="text-body-md text-md-on-surface-variant mb-2">
            Seu período de teste de 14 dias já está ativo.
          </p>
          <p className="text-body-md text-md-on-surface-variant mb-8">
            Faça login com o email do administrador para começar.
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
          background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(92,65,82,0.12) 0%, transparent 70%)',
        }}
      />

      <div className="w-full max-w-md">
        <Link href="/" className="inline-flex items-center gap-2 text-3xl font-black tracking-tight text-white mb-8">
          <span className="text-md-primary">Pontu</span>fy
        </Link>

        <div className="md-card-outlined md-elevation-3 p-8">
          <div className="text-center mb-8">
            <h1 className="text-headline-sm font-bold text-md-on-surface mb-2">Crie sua conta empresarial</h1>
            <p className="text-body-md text-md-on-surface-variant">Cadastre sua empresa e comece com 14 dias grátis</p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            {(error || googleError) && (
              <div
                role="alert"
                className="bg-md-error/10 border border-md-error/30 text-md-error text-body-sm p-3 rounded-xl text-center font-medium"
              >
                {error || googleError}
              </div>
            )}

            <div>
              <label htmlFor="companyName" className="text-label-lg text-md-on-surface-variant mb-1.5 block">
                Nome da empresa
              </label>
              <div className="relative">
                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant/60 size-5 pointer-events-none" aria-hidden="true" />
                <input
                  id="companyName"
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Ex: TechCorp LTDA"
                  className="w-full pl-12 pr-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant/50 focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
                />
              </div>
            </div>

            <div>
              <label htmlFor="sector" className="text-label-lg text-md-on-surface-variant mb-1.5 block">
                Setor
              </label>
              <div className="relative">
                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant/60 size-5 pointer-events-none" aria-hidden="true" />
                <select
                  id="sector"
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  className="w-full pl-12 pr-10 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors appearance-none cursor-pointer"
                >
                  {SECTORS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="adminName" className="text-label-lg text-md-on-surface-variant mb-1.5 block">
                Seu nome
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant/60 size-5 pointer-events-none" aria-hidden="true" />
                <input
                  id="adminName"
                  type="text"
                  required
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="Ex: Maria Silva"
                  className="w-full pl-12 pr-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant/50 focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
                />
              </div>
            </div>

            <div>
              <label htmlFor="adminEmail" className="text-label-lg text-md-on-surface-variant mb-1.5 block">
                Email corporativo
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant/60 size-5 pointer-events-none" aria-hidden="true" />
                <input
                  id="adminEmail"
                  type="email"
                  required
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="voce@empresa.com"
                  className="w-full pl-12 pr-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant/50 focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="text-label-lg text-md-on-surface-variant mb-1.5 block">
                Criar senha
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant/60 size-5 pointer-events-none" aria-hidden="true" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full pl-12 pr-14 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant/50 focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-md-on-surface-variant/60 hover:text-md-on-surface transition-colors"
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
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-md-on-surface-variant/60 size-5 pointer-events-none" aria-hidden="true" />
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant/50 focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
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
                  <Loader2 className="animate-spin" size={20} /> Criando empresa...
                </>
              ) : (
                'Criar minha empresa'
              )}
            </button>
          </form>

          <AuthDivider />
          <GoogleButton
            intent="tenant"
            companyName={companyName}
            sector={sector}
            label="Cadastrar empresa com o Google"
          />

          <div className="mt-6 space-y-3 text-center">
            <p className="text-body-sm text-md-on-surface-variant">
              <Link href="/login" className="font-semibold text-md-primary hover:text-md-primary-container transition-colors flex items-center justify-center gap-1">
                <ArrowLeft size={16} />
                Já tem conta? Fazer login
              </Link>
            </p>
            <p className="text-body-sm text-md-on-surface-variant">
              <Link href="/register" className="font-semibold text-md-primary hover:text-md-primary-container transition-colors flex items-center justify-center gap-1">
                <Mail size={16} />
                Recebeu um convite? Criar conta
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function TenantRegisterPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-md-surface-dim flex items-center justify-center px-4">
          <div className="md-card-outlined md-elevation-3 p-8 w-full max-w-md text-center">
            <Loader2 className="animate-spin mx-auto text-md-primary" size={28} aria-hidden />
          </div>
        </main>
      }
    >
      <TenantRegisterForm />
    </Suspense>
  );
}