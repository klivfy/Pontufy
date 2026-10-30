import { NextResponse } from 'next/server';
import { jsonError, requireHrAdmin } from '@/domain/auth';
import { createCheckoutSession } from '@/domain/billing';
import { logger } from '@/infra/logger';

export async function POST(request: Request) {
  try {
    const { tenantId, userId } = await requireHrAdmin();
    const { plan } = await request.json();
    const result = await createCheckoutSession(tenantId, userId, plan);
    return NextResponse.json(result);
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('POST /api/billing/checkout', { error: String(error) }, 'billing');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
