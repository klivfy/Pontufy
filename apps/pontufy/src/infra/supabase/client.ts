import { createBrowserClient } from '@supabase/ssr';
import { resolveSupabasePublicConfig } from './env';

export function createSupabaseBrowserClient() {
  const config = resolveSupabasePublicConfig();
  if (!config) return null;
  return createBrowserClient(config.url, config.key);
}
