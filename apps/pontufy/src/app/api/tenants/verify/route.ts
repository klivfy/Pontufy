import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyTenantEmail } from '@/domain/tenant';
import { getClientIp, ipRateLimit } from '@/lib/security/auth-guard';
import { parseBody } from '@/lib/validations';
import { logger } from '@/infra/logger';

// Público por natureza (o usuário ainda não tem sessão). O token é a
// credencial: 32 bytes CSPRNG, uso único, TTL de 24h.
const VERIFY_SCHEMA = z.object({ token: z.string().trim().min(32).max(128) });

const VERIFY_MAX_PER_IP = 10;
const VERIFY_WINDOW_SECONDS = 60 * 60;

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rate = await ipRateLimit(ip, 'tenant-verify', VERIFY_MAX_PER_IP, VERIFY_WINDOW_SECONDS);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde alguns minutos.' },
        { status: 429 },
      );
    }

    const raw = await request.json().catch(() => null);
    const { data, error } = parseBody(VERIFY_SCHEMA, raw);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const result = await verifyTenantEmail(data.token);

    if (!result.ok) {
      const status = result.code === 'EXPIRED' ? 410 : result.code === 'ALREADY_USED' ? 409 : 404;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    return NextResponse.json({
      success: true,
      tenantId: result.tenantId,
      creditsGranted: result.creditsGranted,
      message: 'E-mail confirmado. Sua conta está ativa.',
    });
  } catch (error) {
    logger.error('POST /api/tenants/verify', { error: String(error) }, 'tenants');
    return NextResponse.json({ error: 'Erro interno ao confirmar o e-mail.' }, { status: 500 });
  }
}
