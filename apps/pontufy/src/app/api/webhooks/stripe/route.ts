import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { randomBytes } from 'crypto';
import { prisma } from '@/backend/db';
import { hashPassword } from '@/lib/crypto';
import { logAudit } from '@/lib/audit';
import { sendWelcomeEmail, sendPasswordResetEmail } from '@/lib/email';
import { getStripe } from '@/lib/stripe';

const DEFAULT_CREDITS: Record<string, number> = {
  starter: 50,
  professional: 200,
  enterprise: 1000,
};

// Um claim em `processing` expira depois disso; aí o próximo retry pode
// retomar o evento (instance que morreu no meio do processamento).
const PROCESSING_CLAIM_TTL_MS = 60_000;

type ClaimResult = 'claimed' | 'duplicate' | 'in_flight';

/**
 * Reivindica o evento para processamento (idempotência com estados).
 *
 * Antes, o `create` acontecia antes do trabalho e nunca era revertido: uma
 * falha deixava o evento marcado para sempre, e o retry do Stripe virava
 * `duplicate: true` — o pagamento nunca era aplicado.
 */
async function claimEvent(eventId: string, type: string): Promise<ClaimResult> {
  const existing = await prisma.stripeEvent.findUnique({
    where: { eventId },
    select: { id: true, status: true, updatedAt: true },
  });

  if (!existing) {
    try {
      await prisma.stripeEvent.create({ data: { eventId, type, status: 'processing', attempts: 1 } });
      return 'claimed';
    } catch (error) {
      // P2002: outra entrega concorrente criou primeiro.
      if (isUniqueViolation(error)) return 'duplicate';
      throw error;
    }
  }

  if (existing.status === 'processed') return 'duplicate';

  const claimExpired = Date.now() - existing.updatedAt.getTime() > PROCESSING_CLAIM_TTL_MS;
  if (existing.status === 'processing' && !claimExpired) return 'in_flight';

  await prisma.stripeEvent.update({
    where: { eventId },
    data: { status: 'processing', attempts: { increment: 1 } },
  });
  return 'claimed';
}

async function markProcessed(eventId: string, tenantId: string | null): Promise<void> {
  try {
    await prisma.stripeEvent.update({
      where: { eventId },
      data: { tenantId, status: 'processed' },
    });
  } catch (error) {
    console.error('StripeEvent update failed:', error);
  }
}

/** Libera o evento para um novo retry (não perde o trabalho do Stripe). */
async function markFailed(eventId: string): Promise<void> {
  try {
    await prisma.stripeEvent.update({
      where: { eventId },
      data: { status: 'failed' },
    });
  } catch (error) {
    console.error('StripeEvent markFailed error:', error);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002';
}

export async function POST(request: NextRequest) {
  let claimedEventId: string | null = null;

  try {
    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature') || '';
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

    if (!webhookSecret) {
      return NextResponse.json(
        { error: 'STRIPE_WEBHOOK_SECRET não configurada.' },
        { status: 500 },
      );
    }

    const stripe = getStripe();

    // Validação obrigatória da assinatura via SDK (raw body + secret).
    // constructEventAsync usa o corpo exato recebido — nunca re-serializar.
    const event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);

    // ── Idempotência: Stripe redelivers até receber 2xx. ─────────────────
    // O claim só marca o evento como 'processed' no fim; uma falha no meio do
    // caminho o libera ('failed') para o retry.
    const claim = await claimEvent(event.id, event.type);
    if (claim === 'duplicate') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (claim === 'in_flight') {
      return NextResponse.json({ received: true, processing: true });
    }
    claimedEventId = event.id;

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = session.metadata || {};
        const tenantId = metadata.tenant_id || metadata.tenantId || null;

        // Novo fluxo: tenant já existe (onboarding self-service) — ativar
        // subscrição e créditos contratados.
        if (tenantId) {
          const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
          if (!tenant) {
            return NextResponse.json({ error: 'TENANT_NOT_FOUND' }, { status: 404 });
          }

          const plan = metadata.plan === 'enterprise' ? 'enterprise' : 'starter';
          const aiCredits = DEFAULT_CREDITS[plan] ?? DEFAULT_CREDITS.starter;

          await prisma.tenant.update({
            where: { id: tenant.id },
            data: {
              plan,
              stripeCustomerId:
                typeof session.customer === 'string'
                  ? session.customer
                  : tenant.stripeCustomerId,
              stripeSubscriptionId:
                typeof session.subscription === 'string'
                  ? session.subscription
                  : tenant.stripeSubscriptionId,
              stripePriceId: metadata.price_id ?? tenant.stripePriceId,
              subscriptionStatus: 'active',
              trialEndsAt: null,
              aiCredits,
            },
          });

          await logAudit({
            tenantId: tenant.id,
            action: 'SUBSCRIPTION_ACTIVATED',
            entity: 'Tenant',
            entityId: tenant.id,
            newValue: { plan, aiCredits, eventId: event.id },
          });

          await markProcessed(event.id, tenant.id);
          return NextResponse.json({ received: true, tenantId });
        }

        // Fluxo legado (checkout sem tenantId): auto-criação de empresa via
        // checkout — o admin define a senha por link de setup out-of-band.
        const companyName = metadata.company_name;
        const email = session.customer_email || metadata.admin_email;
        const sector = metadata.sector || 'tech';
        const plan = metadata.plan || 'starter';

        if (!companyName || !email) {
          return NextResponse.json({ error: 'MISSING_METADATA' }, { status: 400 });
        }

        const existingTenant = await prisma.tenant.findFirst({
          where: { name: companyName },
        });

        if (existingTenant) {
          await markProcessed(event.id, existingTenant.id);
          return NextResponse.json({
            success: true,
            message: 'TENANT_EXISTS',
            tenantId: existingTenant.id,
          });
        }

        const unusablePassword = hashPassword(randomBytes(32).toString('hex'));
        const aiCredits = DEFAULT_CREDITS[plan] || DEFAULT_CREDITS.starter;
        const setupToken = randomBytes(32).toString('hex');
        const setupExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const result = await prisma.$transaction(async (tx) => {
          const tenant = await tx.tenant.create({
            data: {
              name: companyName,
              slug: `${companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}-${randomBytes(3).toString('hex')}`,
              sector,
              contractStatus: 'active',
              plan,
              aiCredits,
              stripeCustomerId:
                typeof session.customer === 'string' ? session.customer : null,
              stripeSubscriptionId:
                typeof session.subscription === 'string' ? session.subscription : null,
              subscriptionStatus: 'active',
            },
          });

          const admin = await tx.user.create({
            data: {
              tenantId: tenant.id,
              name: `Admin ${companyName}`,
              email,
              role: 'admin_rh',
              passwordHash: unusablePassword,
              pointsBalance: 0,
            },
          });

          await tx.passwordReset.create({
            data: { userId: admin.id, token: setupToken, expiresAt: setupExpiresAt },
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
            companyName,
            sector,
            plan,
            adminEmail: email,
          },
        });

        sendWelcomeEmail(email, `Admin ${companyName}`).catch(() => {});
        sendPasswordResetEmail(email, setupToken).catch(() => {});
        await markProcessed(event.id, result.tenant.id);

        return NextResponse.json({
          success: true,
          tenantId: result.tenant.id,
          adminEmail: email,
        });
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;

        const tenant = await prisma.tenant.findFirst({
          where: {
            OR: [{ stripeCustomerId: customerId || undefined }, { stripeSubscriptionId: subscription.id }],
          },
        });

        if (tenant) {
          await prisma.tenant.update({
            where: { id: tenant.id },
            data: {
              subscriptionStatus:
                event.type === 'customer.subscription.deleted' ? 'canceled' : subscription.status,
              trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
            },
          });
          await markProcessed(event.id, tenant.id);
        } else {
          await markProcessed(event.id, null);
        }
        return NextResponse.json({ received: true });
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

        const tenant = customerId
          ? await prisma.tenant.findFirst({ where: { stripeCustomerId: customerId } })
          : null;

        if (tenant) {
          await prisma.tenant.update({
            where: { id: tenant.id },
            data: { subscriptionStatus: 'past_due' },
          });
          await markProcessed(event.id, tenant.id);
        } else {
          await markProcessed(event.id, null);
        }
        return NextResponse.json({ received: true });
      }

      default:
        await markProcessed(event.id, null);
        return NextResponse.json({ received: true });
    }
  } catch (error) {
    console.error('POST /api/webhooks/stripe:', error);
    // Libera o evento para o próximo retry do Stripe — nunca deixar um
    // pagamento definitivamente não processado por causa de uma exceção.
    if (claimedEventId) await markFailed(claimedEventId);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}