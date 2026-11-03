import { prisma } from '@/infra/db';
import { logAudit } from '@/lib/audit';
import { sendWelcomeEmail } from '@/lib/email';
import { isTenantBlocked, provisionTenant, TENANT_SECTORS, type TenantSector } from '@/domain/tenant';

const VALID_SECTORS = TENANT_SECTORS;

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

  // V3: login comum com e-mail desconhecido NÃO cria empresa. Antes, qualquer
  // conta Google nova provisionava tenant + trial + 20 créditos de IA sem
  // nenhum limite. Agora a criação exige intenção explícita (formulário de
  // empresa ou convite).
  return {
    ok: false,
    code: 'signup_required',
    message:
      'Não encontramos uma conta para este e-mail. Peça um convite ao seu gestor ou cadastre sua empresa.',
  };
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
  const resolvedSector: TenantSector = VALID_SECTORS.includes(sector as TenantSector)
    ? (sector as TenantSector)
    : 'tech';

  // Ponto único de criação de tenant (V3). O Google só entrega o e-mail após
  // verificá-lo, então esta origem entra ativa e recebe os créditos do trial
  // — respeitando o teto diário global dentro de provisionTenant.
  const provisioned = await provisionTenant({
    companyName: resolvedName,
    sector: resolvedSector,
    adminName: name,
    adminEmail: email,
    adminPasswordHash: null,
    emailVerified: true,
    origin: 'google',
  });

  if (!provisioned.ok) {
    return {
      ok: false,
      code: provisioned.code === 'EMAIL_TAKEN' ? 'google_email_taken' : 'google_provision_limit',
      message: provisioned.message,
    };
  }

  return {
    ok: true,
    user: {
      id: provisioned.adminId,
      email,
      name,
      tenantId: provisioned.tenantId,
      role: 'admin_rh',
    },
  };
}
