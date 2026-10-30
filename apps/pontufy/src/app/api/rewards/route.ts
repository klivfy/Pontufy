import { NextResponse } from 'next/server';
import { getSessionContext } from '@/infra/session';
import { jsonError, requireHrAdmin } from '@/domain/auth';
import { listRewards, toggleReward } from '@/domain/rewards';
import { logger } from '@/infra/logger';

export async function GET(request: Request) {
  try {
    const { tenantId } = await getSessionContext();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '12', 10);
    const category = searchParams.get('category');
    const result = await listRewards(tenantId, { page, limit, category });
    return NextResponse.json(result);
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('GET /api/rewards', { error: String(error) }, 'rewards');
    if (mapped.status === 401) return NextResponse.json([], { status: 401 });
    return NextResponse.json(mapped.status >= 500 ? [] : mapped.body, { status: mapped.status });
  }
}

export async function PATCH(request: Request) {
  try {
    const { tenantId } = await requireHrAdmin();
    const { rewardId, isActive } = await request.json();
    if (!rewardId || typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'rewardId e isActive são obrigatórios.' }, { status: 400 });
    }
    const reward = await toggleReward(tenantId, rewardId, isActive);
    return NextResponse.json({ success: true, reward });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('PATCH /api/rewards', { error: String(error) }, 'rewards');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
