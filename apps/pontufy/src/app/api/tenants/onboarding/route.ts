import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/backend/db';
import { hashPassword } from '@/lib/crypto';
import { logAudit } from '@/lib/audit';
import { sendWelcomeEmail } from '@/lib/email';
import { tenantOnboardingSchema, parseBody } from '@/lib/validations';
import { getClientIp, ipRateLimit } from '@/lib/security/auth-guard';
import { logger } from '@/infra/logger';

const TRIAL_DAYS = 14;
const TRIAL_AI_CREDITS = 20;

// Endpoint público: limita criação de empresas por IP (5/hora). Sem isso era
// possível provisionar tenants em loop — custo de banco, e-mails e trial.
const ONBOARDING_MAX_PER_IP = 5;
const ONBOARDING_WINDOW_SECONDS = 60 * 60;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function randomSuffix(): string {
  return randomBytes(3).toString('hex');
}

async function buildUniqueSlug(base: string): Promise<string> {
  const candidate = slugify(base) || `empresa-${randomSuffix()}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = attempt === 0 ? candidate : `${candidate}-${randomSuffix()}`;
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (!existing) return slug;
  }
  return `${candidate}-${randomSuffix()}`;
}

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

    const companyName = body.companyName;
    const sector = body.sector;
    const adminName = body.adminName;
    const normalizedEmail = body.adminEmail;
    const adminPassword = body.adminPassword;

    // Global lookup by design: emails are unique across all tenants.
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: 'Já existe uma conta com este email.' },
        { status: 409 },
      );
    }

    const slug = await buildUniqueSlug(companyName);
    const passwordHash = hashPassword(adminPassword);
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    // Tenant.create is a global platform operation — direct prisma client by design.
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: companyName.trim(),
          slug,
          sector,
          plan: 'trial',
          trialEndsAt,
          aiCredits: TRIAL_AI_CREDITS,
          contractStatus: 'active',
        },
      });

      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: adminName.trim(),
          email: normalizedEmail,
          role: 'admin_rh',
          passwordHash,
          pointsBalance: 0,
        },
      });

      return { tenant, admin };
    });

    await logAudit({
      tenantId: result.tenant.id,
      userId: result.admin.id,
      action: 'TENANT_ONBOARDED',
      entity: 'Tenant',
      entityId: result.tenant.id,
      newValue: {
        tenantId: result.tenant.id,
        companyName: result.tenant.name,
        sector,
        plan: result.tenant.plan,
        adminEmail: normalizedEmail,
      },
    });

    sendWelcomeEmail(normalizedEmail, adminName.trim()).catch(() => {});

    return NextResponse.json({
      success: true,
      tenantId: result.tenant.id,
      slug,
    });
  } catch (error) {
    logger.error('POST /api/tenants/onboarding', { error: String(error) }, 'tenants');
    return NextResponse.json(
      { error: 'Erro interno ao criar a empresa.' },
      { status: 500 },
    );
  }
}
