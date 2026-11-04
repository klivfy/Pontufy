import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { resolveSupabasePublicConfig } from './env';

export async function createSupabaseServerClient() {
  const config = resolveSupabasePublicConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component — the Route Handler / proxy writes cookies.
        }
      },
    },
  });
}

export function createSupabaseRouteClient(request: Request, responseHeaders: Headers) {
  const config = resolveSupabasePublicConfig();
  if (!config) return null;

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '') as {
          name: string;
          value: string;
        }[];
      },
      setAll(cookiesToSet, cacheHeaders) {
        cookiesToSet.forEach(({ name, value, options }) => {
          responseHeaders.append('Set-Cookie', serializeCookieHeader(name, value, options));
        });
        Object.entries(cacheHeaders ?? {}).forEach(([header, value]) => {
          responseHeaders.set(header, value);
        });
      },
    },
  });
}
