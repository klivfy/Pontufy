import { NextResponse } from 'next/server';
import { jsonError, requireHrAdmin } from '@/domain/auth';
import { createPortalSession } from '@/domain/billing';
import { logger } from '@/infra/logger';

export async function POST() {
  try {
    const { tenantId } = await requireHrAdmin();
    const result = await createPortalSession(tenantId);
    return NextResponse.json(result);
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('POST /api/billing/portal', { error: String(error) }, 'billing');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
