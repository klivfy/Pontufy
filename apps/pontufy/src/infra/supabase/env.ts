const MARKETPLACE_PROJECT_URL = 'https://vowmmgbhgcozdqvdcldh.supabase.co';

const URL_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'KLIV_PONT_SUPABASE_URL',
  'NEXT_PUBLIC_KLIV_PONT_SUPABASE_URL',
  'NEXT_PUBLIC_KLIV_PONT_KLIVSUPABASE_URL',
] as const;

const KEY_KEYS = [
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'KLIV_PONT_SUPABASE_ANON_KEY',
  'KLIV_PONT_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_KLIV_PONT_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_KLIV_PONT_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_KLIV_PONT_KLIVSUPABASE_ANON_KEY',
  'NEXT_PUBLIC_KLIV_PONT_KLIVSUPABASE_PUBLISHABLE_KEY',
] as const;

function firstDefined(keys: readonly string[]): { value?: string; source?: string } {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return { value, source: key };
  }
  return {};
}

export type SupabasePublicConfig = {
  url: string;
  key: string;
  urlSource: string;
  keySource: string;
};

export function resolveSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = firstDefined(URL_KEYS);
  const key = firstDefined(KEY_KEYS);
  const resolvedUrl = url.value ?? MARKETPLACE_PROJECT_URL;
  const urlSource = url.source ?? 'marketplace-ref';

  if (!key.value) return null;

  return {
    url: resolvedUrl.replace(/\/$/, ''),
    key: key.value,
    urlSource,
    keySource: key.source ?? 'unknown',
  };
}

export function isSupabaseAuthConfigured(): boolean {
  return resolveSupabasePublicConfig() !== null;
}
