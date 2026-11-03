import { NextResponse } from 'next/server';
import { jsonError } from '@/domain/auth';
import { assertLomadeePostbackToken, processLomadeePostback } from '@/domain/rewards';
import { logger } from '@/infra/logger';

// Token via header (preferido) ou query string (compatibilidade com o
// cadastro existente na Lomadee). O header evita que o segredo apareça em
// access logs, CDN e cabeçalho Referer.
function readPostbackToken(request: Request): string | null {
  const headerToken = request.headers.get('x-pontufy-token');
  if (headerToken) return headerToken;
  return new URL(request.url).searchParams.get('token');
}

export async function POST(request: Request) {
  try {
    assertLomadeePostbackToken(readPostbackToken(request));
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
    assertLomadeePostbackToken(readPostbackToken(request));
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
