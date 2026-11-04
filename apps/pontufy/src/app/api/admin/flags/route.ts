import { NextResponse } from 'next/server';
import { z } from 'zod';

import { jsonError, requireHrAdmin } from '@/domain/auth';
import { isFlagKeyValid, listFlags, normalizeFlagKey, setFlag } from '@/domain/flags';
import { logAudit, extractRequestMeta } from '@/lib/audit';
import { logger } from '@/infra/logger';

// ═══════════════════════════════════════════════════════════════════════════
// C4 — Administração de feature flags do próprio tenant
//
// Escopo: cada empresa controla as SUAS flags. Flag global de plataforma não
// é exposta aqui — quem decide rollout para todos é o super_admin, por deploy
// ou por script.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  key: z.string().min(3).max(80),
  enabled: z.boolean(),
});

export async function GET() {
  try {
    const { tenantId } = await requireHrAdmin();
    const flags = await listFlags(tenantId);
    return NextResponse.json({ flags });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) {
      logger.error('GET /api/admin/flags', { error: String(error) }, 'flags');
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function PATCH(request: Request) {
  try {
    const { tenantId, userId } = await requireHrAdmin();

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
    }

    const key = normalizeFlagKey(parsed.data.key);
    if (!isFlagKeyValid(key)) {
      return NextResponse.json(
        { error: 'Chave inválida. Use o formato dominio.recurso (ex.: ai.review).' },
        { status: 400 },
      );
    }

    await setFlag(tenantId, key, parsed.data.enabled);

    const meta = extractRequestMeta(request);
    await logAudit({
      tenantId,
      userId,
      action: parsed.data.enabled ? 'FEATURE_FLAG_ENABLED' : 'FEATURE_FLAG_DISABLED',
      entity: 'FeatureFlag',
      entityId: key,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newValue: { key, enabled: parsed.data.enabled },
    });

    return NextResponse.json({ success: true, key, enabled: parsed.data.enabled });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) {
      logger.error('PATCH /api/admin/flags', { error: String(error) }, 'flags');
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
