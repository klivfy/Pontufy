import { NextResponse } from 'next/server';
import { createSupabaseRouteClient } from '@/infra/supabase/server';
import { isSupabaseAuthConfigured } from '@/infra/supabase/env';
import { parseGoogleIntent } from '@/domain/auth/google';
import { isSafeRelativePath, loginErrorUrl, resolveAppOrigin } from '@/domain/auth/origin';
import { getClientIp, ipRateLimit } from '@/lib/security/auth-guard';

export const runtime = 'nodejs';

const VALID_SECTORS = new Set(['tech', 'health', 'retail', 'industry']);

export async function GET(request: Request) {
  const origin = resolveAppOrigin(request);
  const { searchParams } = new URL(request.url);
  const intent = parseGoogleIntent(searchParams.get('intent'));
  const next = isSafeRelativePath(searchParams.get('next')) ? searchParams.get('next')! : '/dashboard';
  const errorPath =
    intent === 'invite'
      ? '/register'
      : intent === 'tenant'
        ? '/register/tenant'
        : '/login';

  const ip = getClientIp(request);
  const rate = await ipRateLimit(ip, 'google-oauth', 10, 15 * 60);
  if (!rate.allowed) {
    return NextResponse.redirect(loginErrorUrl(origin, 'google_unavailable', errorPath));
  }

  if (!isSupabaseAuthConfigured()) {
    return NextResponse.redirect(loginErrorUrl(origin, 'google_unavailable', errorPath));
  }

  const callback = new URL('/auth/callback', origin);
  callback.searchParams.set('intent', intent);
  callback.searchParams.set('next', next);

  if (intent === 'invite') {
    const token = searchParams.get('token')?.trim() ?? '';
    if (!token || token.length > 128) {
      return NextResponse.redirect(loginErrorUrl(origin, 'google_invite', '/register'));
    }
    callback.searchParams.set('token', token);
  }

  if (intent === 'tenant') {
    const companyName = searchParams.get('companyName')?.trim() ?? '';
    const sector = searchParams.get('sector')?.trim() ?? 'tech';
    if (companyName.length >= 2 && companyName.length <= 80) {
      callback.searchParams.set('companyName', companyName);
    }
    if (VALID_SECTORS.has(sector)) {
      callback.searchParams.set('sector', sector);
    }
  }

  const responseHeaders = new Headers();
  const supabase = createSupabaseRouteClient(request, responseHeaders);
  if (!supabase) {
    return NextResponse.redirect(loginErrorUrl(origin, 'google_unavailable', errorPath));
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callback.toString(),
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account',
      },
    },
  });

  if (error || !data.url) {
    console.error('[auth/google] signInWithOAuth failed');
    return NextResponse.redirect(loginErrorUrl(origin, 'google_unavailable', errorPath));
  }

  responseHeaders.set('Location', data.url);
  return new Response(null, { status: 303, headers: responseHeaders });
}
