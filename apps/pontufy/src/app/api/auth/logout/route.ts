import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/infra/supabase/server';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
  } catch {
    // Logout do Supabase é best-effort; o NextAuth ainda encerra a sessão da app.
  }
  return NextResponse.json({ ok: true });
}
