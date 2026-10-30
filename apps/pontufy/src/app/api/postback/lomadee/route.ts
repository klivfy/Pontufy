import { NextResponse } from 'next/server';
import { jsonError } from '@/domain/auth';
import { assertLomadeePostbackToken, processLomadeePostback } from '@/domain/rewards';
import { logger } from '@/infra/logger';

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    assertLomadeePostbackToken(searchParams.get('token'));
    const payload = await request.json();
    const result = await processLomadeePostback(payload);
    return NextResponse.json(result);
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) {
      logger.error('POST /api/postback/lomadee', { error: String(error) }, 'postback');
      return NextResponse.json({ success: false, error: 'Erro interno, mas confirmado recebimento' }, { status: 200 });
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    assertLomadeePostbackToken(searchParams.get('token'));
    return NextResponse.json({
      status: 'ok',
      service: 'Lomadee Postback Handler',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const mapped = jsonError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
