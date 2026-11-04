import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/infra/db';
import { sendEmailVerificationEmail, sendWelcomeEmail } from '@/infra/email';
import { logAudit } from '@/lib/audit';
import { logger } from '@/infra/logger';
import { PENDING_VERIFICATION_STATUS } from './status';

// ═══════════════════════════════════════════════════════════════════════════
// Provisionamento de tenant — PONTO ÚNICO (V3 do SEGURANCA-ESTRUTURAL.md)
//
// Antes existiam três caminhos criando `Tenant`, e só o formulário público
// tinha limite:
//   1. POST /api/tenants/onboarding        (rate limit por IP)
//   2. login Google com intent=tenant      (nenhum controle)
//   3. login Google com e-mail desconhecido → createPersonalTenant()
//      (nenhum controle, criava empresa + 20 créditos de IA para qualquer
//       pessoa com uma conta Google)
//
// Agora só esta função cria Tenant, e ela aplica, dentro de uma transação:
//   • teto diário de tenants (kill switch de abuso);
//   • teto diário de créditos de IA concedidos (kill switch de custo);
//   • estado `pending_verification` + créditos 0 até o e-mail ser provado.
//
// E-mail já provado (Google verificado) entra ativo e recebe os créditos na
// hora, respeitando o mesmo teto.
// ═══════════════════════════════════════════════════════════════════════════

export const TRIAL_DAYS = 14;
export const TRIAL_AI_CREDITS = 20;
export const EMAIL_VERIFICATION_TTL_HOURS = 24;

const DEFAULT_MAX_TENANTS_PER_DAY = 50;
const DEFAULT_MAX_AI_CREDITS_PER_DAY = 100;

export type TenantSector = 'tech' | 'health' | 'retail' | 'industry';
export const TENANT_SECTORS: readonly TenantSector[] = ['tech', 'health', 'retail', 'industry'];

export type ProvisionOrigin = 'onboarding' | 'google' | 'import';

export interface ProvisionTenantInput {
  companyName: string;
  sector: TenantSector;
  adminName: string;
  adminEmail: string;
  /** `null` para contas que só entram por SSO. */
  adminPasswordHash?: string | null;
  /** `true` quando o e-mail já foi provado (Google verificado, import interno). */
  emailVerified: boolean;
  origin: ProvisionOrigin;
}

export type ProvisionTenantResult =
  | {
      ok: true;
      tenantId: string;
      adminId: string;
      contractStatus: 'active' | typeof PENDING_VERIFICATION_STATUS;
      aiCredits: number;
      verificationToken?: string;
    }
  | {
      ok: false;
      code: 'EMAIL_TAKEN' | 'DAILY_TENANT_LIMIT';
      message: string;
    };

export type VerifyTenantEmailResult =
  | { ok: true; tenantId: string; creditsGranted: number }
  | { ok: false; code: 'INVALID' | 'ALREADY_USED' | 'EXPIRED'; message: string };

class ProvisionError extends Error {
  constructor(
    public readonly code: 'DAILY_TENANT_LIMIT',
    message: string,
  ) {
    super(message);
    this.name = 'ProvisionError';
  }
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function maxTenantsPerDay(): number {
  return positiveIntFromEnv('PROVISION_MAX_TENANTS_PER_DAY', DEFAULT_MAX_TENANTS_PER_DAY);
}

export function maxAiCreditsPerDay(): number {
  return positiveIntFromEnv('PROVISION_MAX_AI_CREDITS_PER_DAY', DEFAULT_MAX_AI_CREDITS_PER_DAY);
}

/** Chave da cota: dia em UTC, estável entre regiões e entre execuções. */
export function provisioningDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function buildUniqueSlug(base: string): Promise<string> {
  const candidate = slugify(base) || `empresa-${randomBytes(3).toString('hex')}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = attempt === 0 ? candidate : `${candidate}-${randomBytes(3).toString('hex')}`;
    const existing = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
  }

  return `${candidate}-${randomBytes(3).toString('hex')}`;
}

/**
 * Consome uma vaga do dia. Lança quando o teto é atingido — dentro da
 * transação, o que também desfaz o incremento.
 */
async function claimDailyTenantSlot(tx: Prisma.TransactionClient, day: string): Promise<void> {
  const quota = await tx.provisioningQuota.upsert({
    where: { day },
    create: { day, tenants: 1, aiCredits: 0 },
    update: { tenants: { increment: 1 } },
  });

  if (quota.tenants > maxTenantsPerDay()) {
    throw new ProvisionError(
      'DAILY_TENANT_LIMIT',
      'Limite diário de novas empresas atingido. Tente novamente amanhã.',
    );
  }
}

/**
 * Concede créditos respeitando o teto diário global. Devolve quanto foi
 * realmente concedido (pode ser 0 quando o orçamento do dia acabou).
 */
async function grantTrialCredits(
  tx: Prisma.TransactionClient,
  day: string,
  requested: number,
): Promise<number> {
  if (requested <= 0) return 0;

  const current = await tx.provisioningQuota.findUnique({
    where: { day },
    select: { aiCredits: true },
  });

  const alreadyGranted = current?.aiCredits ?? 0;
  const available = Math.max(0, maxAiCreditsPerDay() - alreadyGranted);
  const granted = Math.min(requested, available);

  if (granted > 0) {
    await tx.provisioningQuota.update({
      where: { day },
      data: { aiCredits: { increment: granted } },
    });
  }

  return granted;
}

/**
 * ÚNICO ponto de criação de tenant do sistema.
 */
export async function provisionTenant(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
  const adminEmail = input.adminEmail.trim().toLowerCase();
  const adminName = input.adminName.trim().slice(0, 120);
  const companyName = input.companyName.trim().slice(0, 80);

  // E-mail é único globalmente (User.email @unique): checar antes evita
  // transação condenada e mantém a mensagem de erro clara.
  const existingUser = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: { id: true },
  });
  if (existingUser) {
    return { ok: false, code: 'EMAIL_TAKEN', message: 'Já existe uma conta com este email.' };
  }

  const day = provisioningDayKey();
  const slug = await buildUniqueSlug(companyName);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const verificationToken = input.emailVerified ? null : randomBytes(32).toString('hex');

  try {
    const created = await prisma.$transaction(async (tx) => {
      await claimDailyTenantSlot(tx, day);

      const grantedCredits = input.emailVerified
        ? await grantTrialCredits(tx, day, TRIAL_AI_CREDITS)
        : 0;

      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          slug,
          sector: input.sector,
          plan: 'trial',
          trialEndsAt,
          aiCredits: grantedCredits,
          contractStatus: input.emailVerified ? 'active' : PENDING_VERIFICATION_STATUS,
        },
      });

      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: adminName,
          email: adminEmail,
          role: 'admin_rh',
          passwordHash: input.adminPasswordHash ?? null,
          pointsBalance: 0,
        },
      });

      if (verificationToken) {
        await tx.emailVerification.create({
          data: {
            token: verificationToken,
            email: adminEmail,
            tenantId: tenant.id,
            userId: admin.id,
            expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000),
          },
        });
      }

      return { tenant, admin, grantedCredits };
    });

    await logAudit({
      tenantId: created.tenant.id,
      userId: created.admin.id,
      action: 'TENANT_ONBOARDED',
      entity: 'Tenant',
      entityId: created.tenant.id,
      newValue: {
        companyName,
        sector: input.sector,
        plan: 'trial',
        origin: input.origin,
        contractStatus: created.tenant.contractStatus,
        aiCredits: created.grantedCredits,
        emailVerified: input.emailVerified,
      },
    });

    if (verificationToken) {
      sendEmailVerificationEmail(adminEmail, adminName, verificationToken).catch((error) => {
        logger.error('Falha ao enviar e-mail de verificação', { error: String(error) }, 'tenant');
      });
    } else {
      sendWelcomeEmail(adminEmail, adminName).catch(() => {});
    }

    return {
      ok: true,
      tenantId: created.tenant.id,
      adminId: created.admin.id,
      contractStatus: created.tenant.contractStatus as 'active' | typeof PENDING_VERIFICATION_STATUS,
      aiCredits: created.grantedCredits,
      verificationToken: verificationToken ?? undefined,
    };
  } catch (error) {
    if (error instanceof ProvisionError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

/**
 * Confirma o e-mail do administrador: ativa o tenant e libera os créditos de
 * trial, respeitando o teto diário. Idempotente e de uso único.
 */
export async function verifyTenantEmail(token: string): Promise<VerifyTenantEmailResult> {
  const record = await prisma.emailVerification.findUnique({
    where: { token },
    select: { id: true, tenantId: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record) {
    return { ok: false, code: 'INVALID', message: 'Link de verificação inválido.' };
  }
  if (record.usedAt) {
    return { ok: false, code: 'ALREADY_USED', message: 'Este link já foi utilizado.' };
  }
  if (record.expiresAt < new Date()) {
    return { ok: false, code: 'EXPIRED', message: 'Este link expirou. Solicite um novo.' };
  }

  const day = provisioningDayKey();

  const applied = await prisma.$transaction(async (tx) => {
    // Claim atômico: dois cliques simultâneos no link não liberam duas vezes.
    const claimed = await tx.emailVerification.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) return null;

    const granted = await grantTrialCredits(tx, day, TRIAL_AI_CREDITS);

    await tx.tenant.update({
      where: { id: record.tenantId },
      data: {
        contractStatus: 'active',
        ...(granted > 0 ? { aiCredits: { increment: granted } } : {}),
      },
    });

    return { granted };
  });

  if (!applied) {
    return { ok: false, code: 'ALREADY_USED', message: 'Este link já foi utilizado.' };
  }

  await logAudit({
    tenantId: record.tenantId,
    userId: record.userId,
    action: 'TENANT_EMAIL_VERIFIED',
    entity: 'Tenant',
    entityId: record.tenantId,
    newValue: { aiCreditsGranted: applied.granted },
  });

  return { ok: true, tenantId: record.tenantId, creditsGranted: applied.granted };
}
