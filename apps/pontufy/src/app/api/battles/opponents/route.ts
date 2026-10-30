import { NextResponse } from 'next/server';
import { getSessionContext } from '@/infra/session';
import { jsonError } from '@/domain/auth';
import { listOpponents } from '@/domain/battles';
import { logger } from '@/infra/logger';

export async function GET() {
  try {
    const { tenantId, userId } = await getSessionContext();
    const users = await listOpponents(tenantId, userId);
    return NextResponse.json({ success: true, users });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('GET /api/battles/opponents', { error: String(error) }, 'battles');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
