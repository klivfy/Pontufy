import { NextResponse } from 'next/server';
import { getSessionContext } from '@/infra/session';
import { jsonError } from '@/domain/auth';
import { getDepartmentRanking } from '@/domain/engagement';
import { logger } from '@/infra/logger';

export async function GET() {
  try {
    const { tenantId } = await getSessionContext();
    const ranking = await getDepartmentRanking(tenantId);
    return NextResponse.json({ success: true, ranking });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('GET /api/battles/leaderboard', { error: String(error) }, 'engagement');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
