import { NextResponse } from 'next/server';
import { prisma } from '@/backend/db';
import { hashPassword } from '@/lib/crypto';
import { sendWelcomeEmail } from '@/lib/email';
import { getClientIp } from '@/lib/security/auth-guard';
import { enforceIpRateLimit, securityUnavailableBody } from '@/infra/security-controls';
import { registerSchema, parseBody } from '@/lib/validations';

const REGISTER_MAX = 10;
const REGISTER_WINDOW = 15 * 60;

export async function POST(request: Request) {
  try {
    // 6.1 — Rate limiting por IP (10 criações de conta / 15 min).
    // Fail-closed: sem infra de contagem, não se cria conta (V4).
    const ip = getClientIp(request);
    const rate = await enforceIpRateLimit(ip, 'register', REGISTER_MAX, REGISTER_WINDOW);
    if (rate === 'unavailable') {
      return NextResponse.json(securityUnavailableBody(), { status: 503 });
    }
    if (rate === 'blocked') {
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde alguns minutos.' },
        { status: 429 },
      );
    }

    // 8.1 — Validação centralizada via Zod
    const raw = await request.json().catch(() => null);
    const { data: body, error: validationError } = parseBody(registerSchema, raw);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { token, name, password } = body;

    const invitation = await prisma.invitation.findUnique({ where: { token } });

    if (!invitation) {
      return NextResponse.json({ error: 'Convite inválido.' }, { status: 404 });
    }

    if (invitation.status === 'accepted' || invitation.usedAt) {
      return NextResponse.json(
        { error: 'Este convite já foi utilizado.' },
        { status: 410 },
      );
    }

    if (invitation.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'Este convite expirou. Solicite um novo ao seu gestor.' },
        { status: 410 },
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: invitation.email },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: 'Já existe uma conta com este email.' },
        { status: 409 },
      );
    }

    const passwordHash = hashPassword(password);

    // Criação do utilizador + aceitação do convite: transação atómica.
    await prisma.$transaction([
      prisma.user.create({
        data: {
          email: invitation.email,
          name: name.trim(),
          passwordHash,
          role: invitation.role,
          tenantId: invitation.tenantId,
        },
      }),
      prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted', usedAt: new Date() },
      }),
    ]);

    sendWelcomeEmail(invitation.email, name.trim()).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/auth/register:', error);
    return NextResponse.json(
      { error: 'Erro interno ao criar conta.' },
      { status: 500 },
    );
  }
}
