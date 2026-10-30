import Stripe from 'stripe';

export type StripePlan = 'starter' | 'enterprise';

interface PlanConfig {
  name: string;
  priceIdEnv: string;
  aiCredits: number;
}

const PLANS: Record<StripePlan, PlanConfig> = {
  starter: { name: 'Starter', priceIdEnv: 'STRIPE_PRICE_STARTER', aiCredits: 50 },
  enterprise: { name: 'Enterprise', priceIdEnv: 'STRIPE_PRICE_ENTERPRISE', aiCredits: 1000 },
};

// Lazy singleton — never instantiate Stripe at module top level (serverless
// cold starts must not pay the SDK bootstrap cost unless billing is used).
const globalForStripe = globalThis as unknown as { stripe?: Stripe };

export function getStripe(): Stripe {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY não configurada.');
  }

  const existing = globalForStripe.stripe;
  if (existing) return existing;

  // apiVersion omitido: o SDK usa a versão padrão configurada na conta Stripe.
  const client = new Stripe(apiKey);
  globalForStripe.stripe = client;
  return client;
}

export function getPlanConfig(plan: string): PlanConfig | null {
  if (plan === 'starter' || plan === 'enterprise') return PLANS[plan];
  return null;
}

export function getPriceId(plan: StripePlan): string {
  const config = PLANS[plan];
  const priceId = process.env[config.priceIdEnv];
  if (!priceId) {
    throw new Error(`${config.priceIdEnv} não configurado para o plano ${plan}.`);
  }
  return priceId;
}

export { PLANS };
