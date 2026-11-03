import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getRawPrisma } from '@/infra/db';
import { persistCommission } from '@/domain/rewards';
import { logger } from '@/infra/logger';

// ═══════════════════════════════════════════════════════════════════════════
// Postback de rede de afiliados — FAIL-CLOSED.
//
// Histórico: esta rota verificava a assinatura apenas `if (WEBHOOK_SECRET)`,
// ou seja, sem `AFFILIATE_WEBHOOK_SECRET` configurado ela aceitava POST anônimo
// e creditava `commissionValue * 10` pontos. Pior: o `trackingId` vinha do
// corpo no formato `tenantId:userId:timestamp`, então o atacante escolhia de
// quem era o crédito e quanto valia.
//
// Contrato atual (não flexibilizar):
//   1. `AFFILIATE_WEBHOOK_SECRET` é OBRIGATÓRIO — ausente ⇒ 503 (nunca 200).
//   2. `x-affiliate-signature` = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
//      em hex, e `x-affiliate-timestamp` = unix segundos (±300s).
//   3. `trackingId` precisa existir como `Redemption.trackingSubId`; o tenant e
//      o usuário do crédito vêm do BANCO, nunca do corpo da requisição.
//   4. `commissionValue` tem teto configurável — valor absurdo não vira ponto.
//   5. Idempotência por (tenantId, network, orderId) — já garantida por
//      @@unique no schema e tratada como "já processado", não como erro.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_CLOCK_SKEW_SECONDS = 300;
const DEFAULT_MAX_COMMISSION_VALUE = 50_000;
const DEFAULT_NETWORK = 'unknown';

const affiliatePayloadSchema = z.object({
  trackingId: z.string().trim().min(1).max(200),
  orderId: z.string().trim().min(1).max(200),
  network: z.string().trim().min(1).max(40).optional(),
  orderValue: z.number().finite().nonnegative().max(1_000_000).optional(),
  commissionValue: z.number().finite().nonnegative().max(1_000_000).optional(),
  status: z.enum(['approved', 'pending', 'rejected']),
  currency: z.string().trim().length(3).optional(),
});

function maxCommissionValue(): number {
  const configured = Number(process.env.AFFILIATE_MAX_COMMISSION_VALUE);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_COMMISSION_VALUE;
}

/** Comparação de hex em tempo constante (evita timing attack na assinatura). */
function safeEqualHex(expected: string, provided: string): boolean {
  const bufferExpected = Buffer.from(expected, 'utf8');
  const bufferProvided = Buffer.from(provided, 'utf8');
  if (bufferExpected.length !== bufferProvided.length) return false;
  return timingSafeEqual(bufferExpected, bufferProvided);
}

function verifySignature(rawBody: string, timestamp: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return safeEqualHex(expected, signature.toLowerCase());
}

export async function POST(request: NextRequest) {
  const secret = process.env.AFFILIATE_WEBHOOK_SECRET ?? '';

  // Fail-closed: sem segredo configurado o endpoint não opera.
  if (!secret) {
    logger.error('AFFILIATE_WEBHOOK_SECRET ausente — postback de afiliados desabilitado.', {}, 'affiliates');
    return NextResponse.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-affiliate-signature') ?? '';
  const timestampHeader = request.headers.get('x-affiliate-timestamp') ?? '';
  const timestamp = Number(timestampHeader);

  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    return NextResponse.json({ error: 'MISSING_TIMESTAMP' }, { status: 400 });
  }

  const skewSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (skewSeconds > MAX_CLOCK_SKEW_SECONDS) {
    return NextResponse.json({ error: 'STALE_TIMESTAMP' }, { status: 401 });
  }

  if (!verifySignature(rawBody, timestampHeader, signature, secret)) {
    return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = affiliatePayloadSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_PAYLOAD', issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
      { status: 400 },
    );
  }

  const payload = parsed.data;
  const commissionValue = payload.commissionValue ?? 0;

  if (commissionValue > maxCommissionValue()) {
    logger.warn('Postback de afiliado acima do teto configurado.', {
      orderId: payload.orderId,
      commissionValue,
      cap: maxCommissionValue(),
    }, 'affiliates');
    return NextResponse.json({ error: 'COMMISSION_ABOVE_CAP' }, { status: 422 });
  }

  try {
    // A redenção é a fonte de verdade do par (tenant, usuário).
    // Sem isso, o corpo da requisição poderia escolher quem recebe os pontos.
    const prisma = getRawPrisma();
    const redemption = await prisma.redemption.findUnique({
      where: { trackingSubId: payload.trackingId },
      select: { id: true, tenantId: true, userId: true },
    });

    if (!redemption) {
      logger.warn('Postback de afiliado para trackingId desconhecido.', {
        trackingId: payload.trackingId,
        orderId: payload.orderId,
      }, 'affiliates');
      return NextResponse.json({ error: 'UNKNOWN_TRACKING_ID' }, { status: 404 });
    }

    const { commissionId, alreadyProcessed } = await persistCommission({
      id: `comm_${crypto.randomUUID()}`,
      tenantId: redemption.tenantId,
      network: (payload.network ?? DEFAULT_NETWORK).toLowerCase(),
      trackingId: payload.trackingId,
      userId: redemption.userId,
      orderId: payload.orderId,
      orderValue: payload.orderValue ?? 0,
      commissionValue,
      currency: payload.currency ?? 'BRL',
      status: payload.status,
      receivedAt: new Date().toISOString(),
    });

    if (alreadyProcessed) {
      return NextResponse.json({ success: true, message: 'ALREADY_PROCESSED', commissionId });
    }

    return NextResponse.json({
      success: true,
      message: payload.status === 'approved' ? 'COMMISSION_SETTLED' : `STATUS_${payload.status.toUpperCase()}`,
      commissionId,
      redemptionId: redemption.id,
    });
  } catch (error) {
    logger.error('Falha ao processar postback de afiliado.', { error: String(error) }, 'affiliates');
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
