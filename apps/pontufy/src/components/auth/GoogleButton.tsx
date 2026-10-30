'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

type GoogleIntent = 'login' | 'invite' | 'tenant';

export function googleAuthErrorMessage(error: string | null): string | null {
  if (!error) return null;
  switch (error) {
    case 'google_unavailable':
      return 'Login com Google indisponível no momento. Use email e senha ou tente mais tarde.';
    case 'google_denied':
      return 'Não foi possível concluir o acesso com o Google. Tente novamente.';
    case 'google_email':
      return 'A conta Google precisa compartilhar um email válido.';
    case 'google_invite':
      return 'O Google usado não corresponde ao convite. Entre com o email convidado.';
    case 'google_blocked':
      return 'Esta conta não pode entrar no momento.';
    default:
      return null;
  }
}

type GoogleButtonProps = {
  intent?: GoogleIntent;
  token?: string | null;
  companyName?: string;
  sector?: string;
  next?: string;
  label?: string;
};

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.345 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.655 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function GoogleButton({
  intent = 'login',
  token,
  companyName,
  sector,
  next,
  label = 'Continuar com o Google',
}: GoogleButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = () => {
    setIsLoading(true);
    const params = new URLSearchParams({ intent });
    if (next) params.set('next', next);
    if (intent === 'invite' && token) params.set('token', token);
    if (intent === 'tenant') {
      if (companyName?.trim()) params.set('companyName', companyName.trim());
      if (sector) params.set('sector', sector);
    }
    window.location.assign(`/api/auth/google?${params.toString()}`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading}
      className="md-btn md-btn-outlined w-full mt-2"
    >
      {isLoading ? (
        <Loader2 className="animate-spin" size={18} aria-hidden />
      ) : (
        <GoogleMark />
      )}
      {isLoading ? 'Redirecionando...' : label}
    </button>
  );
}

export function AuthDivider({ label = 'ou' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 my-5" role="separator" aria-label={label}>
      <div className="h-px flex-1 bg-md-outline/60" />
      <span className="text-label-md text-md-on-surface-variant uppercase tracking-wide">{label}</span>
      <div className="h-px flex-1 bg-md-outline/60" />
    </div>
  );
}
