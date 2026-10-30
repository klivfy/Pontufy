import { getTenantDb } from '@/infra/db';
import { getStripe, getPriceId, getPlanConfig } from '@/infra/stripe';
import { resolveBaseUrl } from '@/infra/email';
import { DomainError } from '@/domain/auth';

export async function getBillingSnapshot(tenantId: string) {
  const db = getTenantDb(tenantId);
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: {
      name: true,
      plan: true,
      trialEndsAt: true,
      aiCredits: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionStatus: true,
      contractStatus: true,
    },
  });
  if (!tenant) throw new DomainError('Tenant não encontrado.', 404);
  return tenant;
}

export async function createCheckoutSession(tenantId: string, userId: string, plan: string) {
  const planConfig = getPlanConfig(plan);
  if (!planConfig) throw new DomainError('Plano inválido. Valores aceitos: starter, enterprise', 400);

  const db = getTenantDb(tenantId);
  const [tenant, admin] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId } }),
    db.user.findFirst({ where: { id: userId, tenantId } }),
  ]);
  if (!tenant) throw new DomainError('Tenant não encontrado.', 404);

  const stripe = getStripe();
  let customerId = tenant.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: admin?.email ?? undefined,
      name: tenant.name,
      metadata: { tenantId },
    });
    customerId = customer.id;
    await db.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customerId } });
  }

  const priceId = getPriceId(plan as 'starter' | 'enterprise');
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { tenantId, plan, price_id: priceId },
    subscription_data: { metadata: { tenantId, plan } },
    success_url: `${resolveBaseUrl()}/admin/billing?status=success`,
    cancel_url: `${resolveBaseUrl()}/admin/billing?status=canceled`,
    client_reference_id: tenantId,
  });

  return { url: session.url };
}

export async function createPortalSession(tenantId: string) {
  const db = getTenantDb(tenantId);
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new DomainError('Tenant não encontrado.', 404);
  if (!tenant.stripeCustomerId) {
    throw new DomainError('Nenhuma assinatura ativa para este tenant.', 400);
  }

  const stripe = getStripe();
  const portal = await stripe.billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: `${resolveBaseUrl()}/admin/billing`,
  });
  return { url: portal.url };
}
