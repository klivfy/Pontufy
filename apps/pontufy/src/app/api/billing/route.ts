import { NextResponse } from 'next/server';
import { jsonError, requireHrAdmin } from '@/domain/auth';
import { getBillingSnapshot } from '@/domain/billing';
import { logger } from '@/infra/logger';

export async function GET() {
  try {
    const { tenantId } = await requireHrAdmin();
    const snapshot = await getBillingSnapshot(tenantId);
    return NextResponse.json(snapshot);
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('GET /api/billing', { error: String(error) }, 'billing');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
