import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getSessionContext } from '@/backend/session';
import { getTenantDb, prisma } from '@/backend/db';
import { logAudit, extractRequestMeta } from '@/lib/audit';

const VALID_ROLES = ['employee'] as const;
const TOKEN_EXPIRY_HOURS = 72;

export async function POST(request: Request) {
  try {
    const { tenantId, role, userId: sessionUserId } = await getSessionContext();

    if (role !== 'admin_rh') {
      return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const body = await request.json();
    const { email, role: inviteRole } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Email inválido.' }, { status: 400 });
    }

    if (!inviteRole || !VALID_ROLES.includes(inviteRole)) {
      return NextResponse.json(
        { error: `Role inválido. Valores aceitos: ${VALID_ROLES.join(', ')}` },
        { status: 400 },
      );
    }

    // Global email lookup by design (email is globally unique across tenants).
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: 'Usuário já cadastrado.' }, { status: 409 });
    }

    const db = getTenantDb(tenantId);
    const pendingInvite = await db.invitation.findFirst({
      where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (pendingInvite) {
      return NextResponse.json({ error: 'Convite pendente já existe para este email.' }, { status: 409 });
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    const invitation = await db.invitation.create({
      data: {
        tenantId,
        email,
        token,
        role: inviteRole,
        expiresAt,
      },
    });

    // 9.1 — Auditoria de eventos administrativos sensíveis.
    const meta = extractRequestMeta(request);
    await logAudit({
      tenantId,
      userId: sessionUserId,
      action: 'INVITATION_CREATED',
      entity: 'Invitation',
      entityId: invitation.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newValue: { email, role: inviteRole, expiresAt: expiresAt.toISOString() },
    });

    return NextResponse.json({
      success: true,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
        signupUrl: `/register?token=${token}`,
      },
    });
  } catch (error: any) {
    if (error.message === 'Não autenticado.') {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    console.error('POST /api/admin/users/invite:', error);
    return NextResponse.json({ error: 'Erro interno ao criar convite.' }, { status: 500 });
  }
}
