import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

// MD3 Button — filled/tonal/outlined/text/destructive, pill 40dp, state layer
// no hover. Contraste AA: on-primary #fff sobre primary #495453 (7.9:1).
type Variant = 'filled' | 'tonal' | 'outlined' | 'text' | 'destructive';

const base =
  'inline-flex items-center justify-center gap-2 h-10 px-6 rounded-full text-sm font-semibold tracking-wide transition-all duration-200 select-none whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed';

const variants: Record<Variant, string> = {
  filled: 'bg-md-primary text-md-on-primary hover:bg-md-primary-container active:scale-[0.98] shadow-sm',
  tonal: 'bg-md-secondary/15 text-md-secondary hover:bg-md-secondary/25 active:scale-[0.98]',
  outlined:
    'border border-md-outline text-md-on-surface-variant hover:border-md-outline-variant hover:text-md-on-surface',
  text: 'text-md-primary hover:bg-md-primary/10',
  // Variante própria em vez de sobrescrever classes por fora: `!important` era
  // sintaxe do Tailwind v3 (prefixo) e não existe mais no v4, então o botão
  // destrutivo do AlertDialog renderizava na cor primária.
  destructive: 'bg-md-error text-md-on-error hover:bg-md-error/90 active:scale-[0.98] shadow-sm',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'filled', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${base} ${variants[variant]} ${className ?? ''}`}
      {...props}
    />
  );
});