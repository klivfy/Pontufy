'use client';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface ErrorStateProps {
  title: string;
  description?: string;
  reset: () => void;
}

// Error boundary visual MD3 — compartilhado pelos error.tsx de segmento e raiz.
export function ErrorState({ title, description, reset }: ErrorStateProps) {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 p-8 text-center bg-md-surface-dim">
      <div className="w-16 h-16 rounded-full bg-md-error/15 flex items-center justify-center">
        <AlertTriangle size={28} className="text-md-error" />
      </div>
      <h2 className="text-xl font-bold text-md-on-surface">{title}</h2>
      <p className="text-md-on-surface-variant max-w-md text-sm">
        {description ?? 'Ocorreu um erro ao carregar esta seção. Você pode tentar novamente.'}
      </p>
      <Button variant="tonal" onClick={reset} className="mt-2">
        Tentar Novamente
      </Button>
    </div>
  );
}