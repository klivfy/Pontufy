import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

// Empty State MD3 — superfície tonal, ícone em container terciário (gamificação)
// ou highlight. Reutilizado em catálogo vazio, histórico zerado e sem cursos.
export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-16 px-6 bg-md-surface rounded-2xl border border-md-outline">
      <div className="w-16 h-16 rounded-full bg-md-tertiary/15 flex items-center justify-center">
        <Icon size={28} className="text-md-tertiary" />
      </div>
      <h3 className="text-title-lg text-md-on-surface font-bold">{title}</h3>
      <p className="text-sm text-md-on-surface-variant max-w-sm">{description}</p>
      {actionLabel && onAction && (
        <Button variant="tonal" onClick={onAction} className="mt-2">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}