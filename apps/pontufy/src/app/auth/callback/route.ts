import { NextResponse } from 'next/server';
import { createSupabaseRouteClient } from '@/infra/supabase/server';
import { parseGoogleIntent, upsertGoogleUser } from '@/domain/auth/google';
import { issueGoogleBridgeTicket } from '@/domain/auth/google-ticket';
import { isSafeRelativePath, loginErrorUrl, resolveAppOrigin } from '@/domain/auth/origin';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const origin = resolveAppOrigin(request);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const oauthError = searchParams.get('error');
  const intent = parseGoogleIntent(searchParams.get('intent'));
  const next = isSafeRelativePath(searchParams.get('next')) ? searchParams.get('next')! : '/dashboard';
  const inviteToken = searchParams.get('token');
  const errorPath =
    intent === 'invite' && inviteToken
      ? `/register?token=${encodeURIComponent(inviteToken)}`
      : intent === 'tenant'
        ? '/register/tenant'
        : '/login';

  if (oauthError || !code) {
    return NextResponse.redirect(loginErrorUrl(origin, 'google_denied', errorPath));
  }

  const responseHeaders = new Headers();
  const supabase = createSupabaseRouteClient(request, responseHeaders);
  if (!supabase) {
    return NextResponse.redirect(loginErrorUrl(origin, 'google_unavailable', errorPath));
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    console.error('[auth/callback] exchangeCodeForSession failed');
    return NextResponse.redirect(loginErrorUrl(origin, 'google_denied', errorPath));
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const supabaseUser = userData.user;
  if (userError || !supabaseUser?.email) {
    return NextResponse.redirect(loginErrorUrl(origin, 'google_email', errorPath));
  }

  const metadata = supabaseUser.user_metadata ?? {};
  const name =
    (typeof metadata.full_name === 'string' && metadata.full_name) ||
    (typeof metadata.name === 'string' && metadata.name) ||
    (typeof metadata.given_name === 'string' && metadata.given_name) ||
    '';

  const result = await upsertGoogleUser({
    email: supabaseUser.email,
    name,
    intent,
    inviteToken: inviteToken ?? undefined,
    companyName: searchParams.get('companyName') ?? undefined,
    sector: searchParams.get('sector') ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.redirect(loginErrorUrl(origin, result.code, errorPath));
  }

  const ticket = issueGoogleBridgeTicket(result.user.id);
  const complete = new URL('/auth/complete', origin);
  complete.searchParams.set('ticket', ticket);
  complete.searchParams.set('next', next);

  responseHeaders.set('Location', complete.toString());
  return new Response(null, { status: 303, headers: responseHeaders });
}
