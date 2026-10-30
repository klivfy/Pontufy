import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireHrAdmin } from '@/domain/auth';
import { createSkill, listAdminSkills } from '@/domain/skills';
import { logAudit, extractRequestMeta } from '@/lib/audit';
import { parseBody } from '@/lib/validations';
import { logger } from '@/infra/logger';

const skillSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().max(500).optional(),
  category: z.string().max(40).default('general'),
  targetLevel: z.number().int().min(1).max(5).default(4),
  nodes: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(120),
        description: z.string().max(400).optional(),
        x: z.number().int(),
        y: z.number().int(),
        requiredScore: z.number().int().min(50).max(100).default(80),
        courseId: z.string().uuid().nullable().optional(),
        prerequisiteId: z.string().uuid().nullable().optional(),
      }),
    )
    .max(20)
    .default([]),
});

export async function GET() {
  try {
    const { tenantId } = await requireHrAdmin();
    const skills = await listAdminSkills(tenantId);
    return NextResponse.json({ success: true, skills });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('GET /api/admin/skills', { error: String(error) }, 'skills');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: Request) {
  try {
    const { tenantId, userId } = await requireHrAdmin();
    const raw = await request.json().catch(() => null);
    const { data, error } = parseBody(skillSchema, raw);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const skill = await createSkill(tenantId, data);
    const meta = extractRequestMeta(request);
    await logAudit({
      tenantId,
      userId,
      action: 'SKILL_CREATED',
      entity: 'Skill',
      entityId: skill.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newValue: { name: skill.name, nodes: skill.nodes.length },
    });
    return NextResponse.json({ success: true, skill });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('POST /api/admin/skills', { error: String(error) }, 'skills');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
