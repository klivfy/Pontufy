import { randomBytes } from 'node:crypto';
import { prisma } from '@/infra/db';
import { logAudit } from '@/lib/audit';
import { sendWelcomeEmail } from '@/lib/email';

const VALID_SECTORS = ['tech', 'health', 'retail', 'industry'] as const;
const TRIAL_DAYS = 14;
const TRIAL_AI_CREDITS = 20;

export type GoogleAuthIntent = 'login' | 'invite' | 'tenant';

export type GoogleUpsertInput = {
  email: string;
  name: string;
  intent: GoogleAuthIntent;
  inviteToken?: string;
  companyName?: string;
  sector?: string;
};

export type GoogleUpsertResult =
  | { ok: true; user: { id: string; email: string; name: string; tenantId: string; role: string } }
  | { ok: false; code: string; message: string };

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
  const candidate = slugify(base) || `conta-${randomSuffix()}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = attempt === 0 ? candidate : `${candidate}-${randomSuffix()}`;
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (!existing) return slug;
  }
  return `${candidate}-${randomSuffix()}`;
}

function isTenantBlocked(tenant: {
  contractStatus: string;
  subscriptionStatus: string | null;
} | null): boolean {
  if (!tenant) return true;
  return (
    tenant.contractStatus === 'suspended' ||
    tenant.contractStatus === 'cancelled' ||
    tenant.subscriptionStatus === 'canceled'
  );
}

function normalizeRole(role: string): 'admin_rh' | 'employee' {
  if (role === 'admin_rh') return 'admin_rh';
  return 'employee';
}

function displayName(name: string, email: string): string {
  const trimmed = name.trim();
  if (trimmed.length >= 2) return trimmed.slice(0, 80);
  const local = email.split('@')[0] ?? 'Colaborador';
  return local.slice(0, 80);
}

export function parseGoogleIntent(value: string | null): GoogleAuthIntent {
  if (value === 'invite' || value === 'tenant') return value;
  return 'login';
}

export async function upsertGoogleUser(input: GoogleUpsertInput): Promise<GoogleUpsertResult> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) {
    return { ok: false, code: 'google_email', message: 'A conta Google não enviou um email válido.' };
  }

  const name = displayName(input.name, email);

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
  }

  if (user) {
    if (user.role === 'super_admin' && !user.email.endsWith('@pontufy.com')) {
      return {
        ok: false,
        code: 'google_blocked',
        message: 'Esta conta não pode entrar com o Google.',
      };
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { contractStatus: true, subscriptionStatus: true },
    });
    if (isTenantBlocked(tenant)) {
      return { ok: false, code: 'google_blocked', message: 'A conta da empresa está inativa.' };
    }

    if (input.intent === 'invite' && input.inviteToken) {
      const invitation = await prisma.invitation.findUnique({ where: { token: input.inviteToken } });
      if (invitation && invitation.email.trim().toLowerCase() !== email) {
        return {
          ok: false,
          code: 'google_invite',
          message: 'O Google usado não corresponde ao email do convite.',
        };
      }
    }

    if (!user.name || user.name.trim().length < 2) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name },
      });
    }

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tenantId: user.tenantId,
        role: user.role,
      },
    };
  }

  if (input.intent === 'invite') {
    return createFromInvitation(email, name, input.inviteToken);
  }

  if (input.intent === 'tenant') {
    return createCompanyTenant(email, name, input.companyName, input.sector);
  }

  return createPersonalTenant(email, name);
}

async function createFromInvitation(
  email: string,
  name: string,
  token?: string,
): Promise<GoogleUpsertResult> {
  if (!token) {
    return { ok: false, code: 'google_invite', message: 'Convite ausente. Use o link enviado pelo gestor.' };
  }

  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation) {
    return { ok: false, code: 'google_invite', message: 'Convite inválido.' };
  }
  if (invitation.status === 'accepted' || invitation.usedAt) {
    return { ok: false, code: 'google_invite', message: 'Este convite já foi utilizado.' };
  }
  if (invitation.expiresAt < new Date()) {
    return { ok: false, code: 'google_invite', message: 'Este convite expirou. Solicite um novo ao seu gestor.' };
  }
  if (invitation.email.trim().toLowerCase() !== email) {
    return {
      ok: false,
      code: 'google_invite',
      message: 'Entre com a conta Google do email convidado.',
    };
  }

  const role = normalizeRole(invitation.role);
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name,
        passwordHash: null,
        role,
        tenantId: invitation.tenantId,
      },
    });
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted', usedAt: new Date() },
    });
    return user;
  });

  sendWelcomeEmail(email, name).catch(() => {});
  await logAudit({
    tenantId: created.tenantId,
    userId: created.id,
    action: 'USER_REGISTERED_GOOGLE',
    entity: 'User',
    entityId: created.id,
    newValue: { role: created.role, via: 'invite' },
  });

  return {
    ok: true,
    user: {
      id: created.id,
      email: created.email,
      name: created.name,
      tenantId: created.tenantId,
      role: created.role,
    },
  };
}

async function createCompanyTenant(
  email: string,
  name: string,
  companyName?: string,
  sector?: string,
): Promise<GoogleUpsertResult> {
  const resolvedName =
    typeof companyName === 'string' && companyName.trim().length >= 2
      ? companyName.trim().slice(0, 80)
      : `Empresa de ${name}`;
  const resolvedSector = VALID_SECTORS.includes(sector as (typeof VALID_SECTORS)[number])
    ? (sector as (typeof VALID_SECTORS)[number])
    : 'tech';

  const slug = await buildUniqueSlug(resolvedName);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: resolvedName,
        slug,
        sector: resolvedSector,
        plan: 'trial',
        trialEndsAt,
        aiCredits: TRIAL_AI_CREDITS,
        contractStatus: 'active',
      },
    });
    const admin = await tx.user.create({
      data: {
        tenantId: tenant.id,
        name,
        email,
        role: 'admin_rh',
        passwordHash: null,
        pointsBalance: 0,
      },
    });
    return { tenant, admin };
  });

  sendWelcomeEmail(email, name).catch(() => {});
  await logAudit({
    tenantId: result.tenant.id,
    userId: result.admin.id,
    action: 'TENANT_ONBOARDED',
    entity: 'Tenant',
    entityId: result.tenant.id,
    newValue: { via: 'google', companyName: resolvedName, sector: resolvedSector },
  });

  return {
    ok: true,
    user: {
      id: result.admin.id,
      email: result.admin.email,
      name: result.admin.name,
      tenantId: result.admin.tenantId,
      role: result.admin.role,
    },
  };
}

async function createPersonalTenant(email: string, name: string): Promise<GoogleUpsertResult> {
  const slug = await buildUniqueSlug(email.split('@')[0] || name);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: `Conta de ${name}`,
        slug,
        sector: 'tech',
        plan: 'trial',
        trialEndsAt,
        aiCredits: TRIAL_AI_CREDITS,
        contractStatus: 'active',
      },
    });
    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        name,
        email,
        role: 'employee',
        passwordHash: null,
        pointsBalance: 0,
      },
    });
    return user;
  });

  sendWelcomeEmail(email, name).catch(() => {});
  await logAudit({
    tenantId: result.tenantId,
    userId: result.id,
    action: 'USER_REGISTERED_GOOGLE',
    entity: 'User',
    entityId: result.id,
    newValue: { role: 'employee', via: 'personal' },
  });

  return {
    ok: true,
    user: {
      id: result.id,
      email: result.email,
      name: result.name,
      tenantId: result.tenantId,
      role: result.role,
    },
  };
}
