import { NextResponse } from 'next/server';
import { hashPassword } from '@/lib/crypto';
import { tenantOnboardingSchema, parseBody } from '@/lib/validations';
import { getClientIp, ipRateLimit } from '@/lib/security/auth-guard';
import { provisionTenant } from '@/domain/tenant';
import { logger } from '@/infra/logger';

// Endpoint público: limita criação de empresas por IP (5/hora).
// O limite por IP é a PRIMEIRA barreira; a definitiva vive em `provisionTenant`
// (teto diário global + estado pendente até verificar o e-mail) — V3 do
// SEGURANCA-ESTRUTURAL.md.
const ONBOARDING_MAX_PER_IP = 5;
const ONBOARDING_WINDOW_SECONDS = 60 * 60;

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rate = await ipRateLimit(ip, 'tenant-onboarding', ONBOARDING_MAX_PER_IP, ONBOARDING_WINDOW_SECONDS);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Muitas solicitações. Tente novamente mais tarde.' },
        { status: 429 },
      );
    }

    const raw = await request.json().catch(() => null);
    const { data: body, error: validationError } = parseBody(tenantOnboardingSchema, raw);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const result = await provisionTenant({
      companyName: body.companyName,
      sector: body.sector,
      adminName: body.adminName,
      adminEmail: body.adminEmail,
      adminPasswordHash: hashPassword(body.adminPassword),
      // Formulário público: o e-mail ainda não foi provado.
      emailVerified: false,
      origin: 'onboarding',
    });

    if (!result.ok) {
      const status = result.code === 'DAILY_TENANT_LIMIT' ? 429 : 409;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    return NextResponse.json(
      {
        success: true,
        tenantId: result.tenantId,
        verificationRequired: true,
        message:
          'Empresa criada. Confirme o e-mail enviado para ativar a conta e liberar os créditos de IA.',
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('POST /api/tenants/onboarding', { error: String(error) }, 'tenants');
    return NextResponse.json(
      { error: 'Erro interno ao criar a empresa.' },
      { status: 500 },
    );
  }
}
