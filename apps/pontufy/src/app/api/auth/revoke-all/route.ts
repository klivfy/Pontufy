import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { bumpUserSessionVersion } from '@/infra/session-version';

// 7.3 — Revogação instantânea de TODAS as sessões do usuário autenticado
// (comprometimento, dispositivo roubado, troca de senha forçada).
//
// A versão agora vive no banco (V5). Antes, sem Redis, este endpoint era um
// no-op: ninguém era desconectado e o JWT seguia válido por até 7 dias.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }

  const version = await bumpUserSessionVersion(session.user.id);

  return NextResponse.json({ success: true, sessionVersion: version });
}
