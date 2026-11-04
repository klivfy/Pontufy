import { NextResponse } from 'next/server';
import { jsonError, requireSuperAdmin } from '@/domain/auth';
import { listBlockedIps, unblockIp } from '@/lib/security/auth-guard';

// 6.5 — Painel de monitoramento de IPs bloqueados.
// Guarda: requireSuperAdmin() relê papel e domínio do BANCO (V5). Antes o papel
// vinha do JWT e um super_admin rebaixado continuava entrando até expirar.
export async function GET() {
  try {
    await requireSuperAdmin();
    const ips = await listBlockedIps();
    return NextResponse.json({ ips });
  } catch (error) {
    const mapped = jsonError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSuperAdmin();

    const { ip } = await request.json();
    if (!ip || typeof ip !== 'string') {
      return NextResponse.json({ error: 'IP inválido.' }, { status: 400 });
    }

    await unblockIp(ip);
    return NextResponse.json({ success: true });
  } catch (error) {
    const mapped = jsonError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
