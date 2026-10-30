import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireHrAdmin } from '@/domain/auth';
import { assignPdiNode, listPdiTargets } from '@/domain/skills';
import { logAudit, extractRequestMeta } from '@/lib/audit';
import { parseBody } from '@/lib/validations';
import { logger } from '@/infra/logger';

const pdiSchema = z.object({
  userId: z.string().uuid(),
  skillNodeId: z.string().uuid(),
});

export async function GET() {
  try {
    const { tenantId } = await requireHrAdmin();
    const pdis = await listPdiTargets(tenantId);
    return NextResponse.json({ success: true, pdis });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('GET /api/admin/skills/pdi', { error: String(error) }, 'skills');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: Request) {
  try {
    const { tenantId, userId } = await requireHrAdmin();
    const raw = await request.json().catch(() => null);
    const { data, error } = parseBody(pdiSchema, raw);
    if (error) return NextResponse.json({ error }, { status: 400 });

    await assignPdiNode(tenantId, data.userId, data.skillNodeId);
    const meta = extractRequestMeta(request);
    await logAudit({
      tenantId,
      userId,
      action: 'PDI_NODE_ASSIGNED',
      entity: 'UserSkillProgress',
      entityId: data.skillNodeId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newValue: { userId: data.userId, skillNodeId: data.skillNodeId },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('POST /api/admin/skills/pdi', { error: String(error) }, 'skills');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
