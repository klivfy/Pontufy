import { test, expect } from '@playwright/test';
import Stripe from 'stripe';
import { prisma } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// F2.1 — Idempotência do webhook do Stripe
//
// Regressão que este teste protege: o evento era gravado como "processado"
// ANTES do trabalho. Se o processamento falhasse, o Stripe reenviava e caía em
// `if (existing) return duplicate` — o pagamento nunca era aplicado.
//
// Agora o evento tem estados (processing/processed/failed): o primeiro POST
// processa, o segundo responde `duplicate`, e um evento em `failed` pode ser
// retomado pelo retry.
//
// Requer STRIPE_WEBHOOK_SECRET no ambiente do servidor de teste (o mesmo que a
// aplicação usa para validar a assinatura).
// ═══════════════════════════════════════════════════════════════════════════

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

function signedHeaders(payload: string): Record<string, string> {
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { 'stripe-signature': signature, 'content-type': 'application/json' };
}

test.describe('Stripe webhook — idempotência com estados', () => {
  test.skip(!WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET não configurado no ambiente de teste.');

  test('primeiro POST processa, segundo responde duplicate (sem reprocessar)', async ({ request }) => {
    const eventId = `evt_test_idem_${Date.now()}`;
    await prisma.stripeEvent.deleteMany({ where: { eventId } });

    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: `sub_test_${Date.now()}`,
          object: 'subscription',
          customer: 'cus_test_inexistente',
          status: 'active',
        },
      },
    });

    const first = await request.post('/api/webhooks/stripe', {
      headers: signedHeaders(payload),
      data: payload,
    });
    expect(first.status(), 'primeira entrega deve ser aceita').toBe(200);

    const stored = await prisma.stripeEvent.findUnique({ where: { eventId } });
    expect(stored?.status, 'evento deve terminar como processed').toBe('processed');
    expect(stored?.attempts).toBe(1);

    const second = await request.post('/api/webhooks/stripe', {
      headers: signedHeaders(payload),
      data: payload,
    });
    expect(second.status()).toBe(200);
    expect((await second.json()).duplicate).toBe(true);

    const after = await prisma.stripeEvent.findUnique({ where: { eventId } });
    expect(after?.attempts, 'reentrega não deve incrementar tentativas de processamento').toBe(1);

    await prisma.stripeEvent.deleteMany({ where: { eventId } });
  });

  test('evento em failed é retomado pelo retry', async ({ request }) => {
    const eventId = `evt_test_retry_${Date.now()}`;

    // Simula um processamento que morreu no meio.
    await prisma.stripeEvent.create({
      data: { eventId, type: 'customer.subscription.updated', status: 'failed', attempts: 1 },
    });

    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: `sub_retry_${Date.now()}`,
          object: 'subscription',
          customer: 'cus_test_inexistente',
          status: 'active',
        },
      },
    });

    const res = await request.post('/api/webhooks/stripe', {
      headers: signedHeaders(payload),
      data: payload,
    });
    expect(res.status()).toBe(200);

    const stored = await prisma.stripeEvent.findUnique({ where: { eventId } });
    expect(stored?.status, 'retry precisa conseguir concluir o evento').toBe('processed');
    expect(stored?.attempts).toBeGreaterThanOrEqual(2);

    await prisma.stripeEvent.deleteMany({ where: { eventId } });
  });
});
