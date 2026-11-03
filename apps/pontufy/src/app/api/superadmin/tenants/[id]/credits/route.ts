import { NextResponse } from 'next/server';
import { getRawPrisma } from '@/infra/platform-db';
import { jsonError, requireSuperAdmin } from '@/domain/auth';
import { logAudit, extractRequestMeta } from '@/lib/audit';

// Consola global de governança — exclusiva para super_admin @pontufy.com.
// Visão consolidada entre empresas via client de plataforma (exceção ao Zero
// Trust, por design); a escrita é auditada no tenant alvo.
//
// Guarda via requireSuperAdmin(): papel e domínio relidos do BANCO (V5), não
// do token. Um super_admin rebaixado perde acesso na requisição seguinte.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireSuperAdmin();

    const prisma = getRawPrisma();
    const { id } = await context.params;
    const body = await request.json();
    const aiCredits = body?.aiCredits;

    if (typeof aiCredits !== 'number' || !Number.isInteger(aiCredits) || aiCredits < 0 || aiCredits > 1_000_000) {
      return NextResponse.json(
        { error: 'Créditos de IA inválidos (inteiro entre 0 e 1.000.000).' },
        { status: 400 },
      );
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, aiCredits: true },
    });
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant não encontrado.' }, { status: 404 });
    }

    const updated = await prisma.tenant.update({
      where: { id },
      data: { aiCredits },
      select: { id: true, name: true, aiCredits: true },
    });

    const meta = extractRequestMeta(request);
    await logAudit({
      tenantId: tenant.id,
      userId,
      action: 'AI_CREDITS_ADJUSTED',
      entity: 'Tenant',
      entityId: tenant.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      oldValue: { aiCredits: tenant.aiCredits },
      newValue: { aiCredits: updated.aiCredits },
    });

    return NextResponse.json({ success: true, tenant: updated });
  } catch (error) {
    const mapped = jsonError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
