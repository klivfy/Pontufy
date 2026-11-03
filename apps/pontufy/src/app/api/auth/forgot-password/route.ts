import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/backend/db';
import { hashPassword } from '@/lib/crypto';
import { sendPasswordResetEmail } from '@/lib/email';
import { getClientIp } from '@/lib/security/auth-guard';
import { enforceIpRateLimit, securityUnavailableBody } from '@/infra/security-controls';
import { forgotPasswordSchema, resetPasswordSchema, parseBody } from '@/lib/validations';

const TOKEN_EXPIRY_HOURS = 1;
const FORGOT_MAX = 5;
const FORGOT_WINDOW = 15 * 60;
const RESET_MAX = 10;
const RESET_WINDOW = 15 * 60;

export async function POST(request: Request) {
  try {
    // 6.1 — Rate limiting por IP (5 solicitações / 15 min) — anti-spam.
    // Fail-closed: sem infra de contagem, não se dispara e-mail (V4).
    const ip = getClientIp(request);
    const rate = await enforceIpRateLimit(ip, 'forgot-password', FORGOT_MAX, FORGOT_WINDOW);
    if (rate === 'unavailable') {
      return NextResponse.json(securityUnavailableBody(), { status: 503 });
    }
    if (rate === 'blocked') {
      return NextResponse.json(
        { error: 'Muitas solicitações. Aguarde 15 minutos.' },
        { status: 429 },
      );
    }

    // 8.1 — Validação centralizada via Zod
    const raw = await request.json().catch(() => null);
    const { data: body, error: validationError } = parseBody(forgotPasswordSchema, raw);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { email } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Email inválido.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json({ success: true });
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await prisma.passwordReset.upsert({
      where: { userId: user.id },
      update: { token, expiresAt, usedAt: null },
      create: { userId: user.id, token, expiresAt },
    });

    await sendPasswordResetEmail(email, token);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/auth/forgot-password:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    // Troca de senha também é caminho de autenticação: mesma política de
    // fail-closed e rate limit (antes este endpoint não tinha nenhum dos dois).
    const ip = getClientIp(request);
    const rate = await enforceIpRateLimit(ip, 'reset-password', RESET_MAX, RESET_WINDOW);
    if (rate === 'unavailable') {
      return NextResponse.json(securityUnavailableBody(), { status: 503 });
    }
    if (rate === 'blocked') {
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde 15 minutos.' },
        { status: 429 },
      );
    }

    // 8.1 — Validação centralizada via Zod
    const raw = await request.json().catch(() => null);
    const { data: body, error: validationError } = parseBody(resetPasswordSchema, raw);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { token, newPassword } = body;

    const reset = await prisma.passwordReset.findUnique({ where: { token } });

    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Token expirado ou inválido.' }, { status: 400 });
    }

    const passwordHash = hashPassword(newPassword);

    await prisma.$transaction([
      prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
      prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('PUT /api/auth/forgot-password:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
