// Motor White-Label: validação e injeção segura de identidade visual por tenant.
//
// Higienização estrita de cores hex (`#RGB` ou `#RRGGBB`) — a rejeição de
// qualquer outro formato impede CSS Injection / exfiltração por atributos
// arbitrários. As variáveis CSS (`--brand-primary`, `--brand-accent`) são os
// únicos pontos de injeção; os tokens base do tema escuro permanecem intactos.

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

export const DEFAULT_PRIMARY_COLOR = '#495453';
export const DEFAULT_ACCENT_COLOR = '#A7E3C1';

/** Retorna a cor normalizada (#RRGGBB) ou null se inválida. */
export function sanitizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!HEX_COLOR_REGEX.test(trimmed)) return null;

  if (trimmed.length === 4) {
    const expanded = trimmed
      .slice(1)
      .split('')
      .map((c) => c + c)
      .join('');
    return `#${expanded.toUpperCase()}`;
  }
  return trimmed.toUpperCase();
}

/** Aceita URLs absolutas (https://) ou relativas (/...) com limite de tamanho. */
export function sanitizeBrandingUrl(value: unknown, maxLength = 500): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return null;
  if (!/^(https?:\/\/|\/)/i.test(trimmed)) return null;
  return trimmed;
}

export interface Branding {
  name?: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
}

export interface BrandingCssVars {
  '--brand-primary': string;
  '--brand-accent': string;
}

/** Constrói as CSS variables seguras (sempre com fallback aos padrões). */
export function buildBrandingCssVars(branding: Branding | null | undefined): BrandingCssVars {
  return {
    '--brand-primary':
      sanitizeHexColor(branding?.primaryColor) ?? DEFAULT_PRIMARY_COLOR,
    '--brand-accent':
      sanitizeHexColor(branding?.accentColor) ?? DEFAULT_ACCENT_COLOR,
  };
}