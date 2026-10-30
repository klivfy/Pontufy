import { NextResponse } from 'next/server';
import { getSessionContext } from '@/infra/session';
import { jsonError } from '@/domain/auth';
import { getSkillTree } from '@/domain/skills';
import { logger } from '@/infra/logger';

export async function GET() {
  try {
    const { tenantId, userId } = await getSessionContext();
    const tree = await getSkillTree(tenantId, userId);
    return NextResponse.json({ success: true, skills: tree });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('GET /api/skills/tree', { error: String(error) }, 'skills');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
