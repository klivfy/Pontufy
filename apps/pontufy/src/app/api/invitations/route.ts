import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionContext } from '@/backend/session';
import { getTenantDb, prisma } from '@/backend/db';
import { logAudit, extractRequestMeta } from '@/lib/audit';
import { resolveBaseUrl, sendInvitationEmail } from '@/lib/email';

const VALID_ROLES = ['admin_rh', 'employee'] as const;
const INVITATION_EXPIRY_DAYS = 7;

export async function GET() {
  try {
    const { tenantId, role } = await getSessionContext();

    if (role !== 'admin_rh') {
      return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    // Internal team management: strictly tenant-scoped via getTenantDb.
    const db = getTenantDb(tenantId);
    const [invitations, users] = await Promise.all([
      db.invitation.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      db.user.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          pointsBalance: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return NextResponse.json({
      invitations: invitations.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        expiresAt: invite.expiresAt.toISOString(),
        usedAt: invite.usedAt?.toISOString() ?? null,
        createdAt: invite.createdAt.toISOString(),
        signupUrl: `${resolveBaseUrl()}/register?token=${invite.token}`,
      })),
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        pointsBalance: user.pointsBalance,
        createdAt: user.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Não autenticado.') {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    console.error('GET /api/invitations:', error);
    return NextResponse.json({ error: 'Erro interno ao listar convites.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { tenantId, role, userId } = await getSessionContext();

    if (role !== 'admin_rh') {
      return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const body = await request.json();
    const { email, role: inviteRole } = body;

    if (typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Email inválido.' }, { status: 400 });
    }

    if (!VALID_ROLES.includes(inviteRole)) {
      return NextResponse.json(
        { error: `Role inválido. Valores aceitos: ${VALID_ROLES.join(', ')}` },
        { status: 400 },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Global email lookup by design (email is globally unique across tenants).
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      return NextResponse.json({ error: 'Usuário já cadastrado.' }, { status: 409 });
    }

    const db = getTenantDb(tenantId);
    const pendingInvite = await db.invitation.findFirst({
      where: {
        tenantId,
        email: normalizedEmail,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
    });
    if (pendingInvite) {
      return NextResponse.json(
        { error: 'Convite pendente já existe para este email.' },
        { status: 409 },
      );
    }

    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const token = randomUUID();

    const invitation = await db.invitation.create({
      data: {
        tenantId,
        email: normalizedEmail,
        token,
        role: inviteRole,
        status: 'pending',
        expiresAt,
      },
    });

    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    const signupUrl = `${resolveBaseUrl()}/register?token=${token}`;

    sendInvitationEmail(normalizedEmail, tenant?.name ?? 'sua empresa', signupUrl, expiresAt).catch(
      () => {},
    );

    const meta = extractRequestMeta(request);
    await logAudit({
      tenantId,
      userId,
      action: 'INVITATION_CREATED',
      entity: 'Invitation',
      entityId: invitation.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newValue: { email: normalizedEmail, role: inviteRole, expiresAt: expiresAt.toISOString() },
    });

    return NextResponse.json({
      success: true,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt.toISOString(),
        signupUrl,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Não autenticado.') {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    console.error('POST /api/invitations:', error);
    return NextResponse.json({ error: 'Erro interno ao criar convite.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { tenantId, role, userId } = await getSessionContext();

    if (role !== 'admin_rh') {
      return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const body = await request.json();
    const { id } = body;

    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Identificador do convite inválido.' }, { status: 400 });
    }

    const db = getTenantDb(tenantId);
    const invitation = await db.invitation.findFirst({
      where: { id, tenantId, status: 'pending' },
    });
    if (!invitation) {
      return NextResponse.json({ error: 'Convite não encontrado.' }, { status: 404 });
    }

    // Revogar: o token deixa de ser utilizável no registo.
    const revoked = await db.invitation.update({
      where: { id },
      data: { status: 'expired', usedAt: new Date() },
    });

    const meta = extractRequestMeta(request);
    await logAudit({
      tenantId,
      userId,
      action: 'INVITATION_REVOKED',
      entity: 'Invitation',
      entityId: invitation.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      oldValue: { email: invitation.email, status: invitation.status },
      newValue: { email: revoked.email, status: revoked.status },
    });

    return NextResponse.json({ success: true, status: revoked.status });
  } catch (error) {
    if (error instanceof Error && error.message === 'Não autenticado.') {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    console.error('PATCH /api/invitations:', error);
    return NextResponse.json({ error: 'Erro interno ao revogar convite.' }, { status: 500 });
  }
}
