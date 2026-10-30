import { NextResponse } from 'next/server';
import { jsonError, requireHrAdmin } from '@/domain/auth';
import { listAdminRewards } from '@/domain/rewards';
import { logger } from '@/infra/logger';

export async function GET() {
  try {
    const { tenantId } = await requireHrAdmin();
    const rewards = await listAdminRewards(tenantId);
    return NextResponse.json({ data: rewards });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('GET /api/admin/rewards', { error: String(error) }, 'rewards');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
