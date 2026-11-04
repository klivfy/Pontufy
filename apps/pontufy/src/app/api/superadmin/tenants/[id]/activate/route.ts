import { NextResponse } from 'next/server';
import { z } from 'zod';

import { jsonError, requireSuperAdmin } from '@/domain/auth';
import { activateTenantManually } from '@/domain/tenant';
import { logger } from '@/infra/logger';
import { parseBody } from '@/lib/validations';

// ═══════════════════════════════════════════════════════════════════════════
// Ativação manual de empresa — suporte
//
// Existe por causa de um furo real: tenant nasce em `pending_verification` e o
// login é bloqueado até o e-mail ser confirmado. Quando o e-mail não chega
// (provedor sem chave, domínio em spam, worker parado), não havia NENHUM
// caminho de liberação — nem para o suporte, nem para o cliente.
//
// Não é um atalho para pular verificação: é a saída de emergência, restrita a
// super_admin @pontufy.com, com motivo obrigatório e auditoria crítica.
// `suspended`/`cancelled` são recusados pela camada de domínio.
// ═══════════════════════════════════════════════════════════════════════════

const ACTIVATE_SCHEMA = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Descreva o motivo (mínimo 10 caracteres).')
    .max(500, 'Motivo muito longo.'),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireSuperAdmin();
    const { id } = await context.params;

    const raw = await request.json().catch(() => null);
    const { data, error } = parseBody(ACTIVATE_SCHEMA, raw);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const result = await activateTenantManually({
      tenantId: id,
      actorUserId: userId,
      reason: data.reason,
    });

    if (!result.ok) {
      const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'NOT_PENDING' ? 409 : 400;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    return NextResponse.json({
      success: true,
      tenantId: result.tenantId,
      creditsGranted: result.creditsGranted,
      alreadyActive: result.alreadyActive,
      message: result.alreadyActive
        ? 'Empresa já estava ativa.'
        : 'Empresa ativada. O login do administrador está liberado.',
    });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) {
      logger.error('POST /api/superadmin/tenants/[id]/activate', { error: String(error) }, 'tenants');
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
