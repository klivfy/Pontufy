'use client';

import { signOut } from 'next-auth/react';

export async function signOutAll(callbackUrl = '/login') {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // Continua o logout do NextAuth mesmo se o Supabase falhar.
  }
  await signOut({ callbackUrl });
}
