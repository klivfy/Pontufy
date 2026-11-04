'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck, Mail, Lock, Eye, EyeOff } from 'lucide-react';

export default function SuperAdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.endsWith('@pontufy.com')) {
      setError('Acesso restrito a colaboradores @pontufy.com.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const res = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (res?.error) {
        setError('Credenciais inválidas ou domínio não autorizado.');
      } else {
        router.push('/superadmin');
        router.refresh();
      }
    } catch {
      setError('Erro ao conectar ao servidor.');
    } finally {
      setIsLoading(false);
    }
  };

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
        <div className="md-card-outlined md-elevation-3 p-8">
          <div className="flex items-center justify-center gap-3 mb-8">
            <ShieldCheck className="text-md-primary" size={28} />
            <span className="text-headline-sm font-black text-md-on-surface tracking-tight">Pontufy Staff</span>
          </div>

          <h1 className="text-title-lg font-semibold text-md-on-surface mb-6 text-center">Acesso Restrito</h1>

          <form onSubmit={handleSubmit} className="space-y-5">
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
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@pontufy.com"
                  className="w-full pl-12 pr-4 py-3.5 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
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
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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

            <button
              type="submit"
              disabled={isLoading}
              className="md-btn md-btn-filled w-full"
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : 'Entrar'}
            </button>
          </form>

          <p className="mt-6 text-center text-body-sm text-md-on-surface-variant">
            Acesso exclusivo para colaboradores da Pontufy S/A
          </p>
        </div>
      </div>
    </main>
  );
}