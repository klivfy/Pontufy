import { test, expect } from '@playwright/test';
import { prisma } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Integridade de Webhooks & Postbacks
// Assinaturas inválidas devem ser rejeitadas SEM efeitos colaterais (nada
// gravado, nenhum crédito, nenhum tenant criado).
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Webhooks com assinatura inválida', () => {
  test('POST /api/webhooks/stripe com assinatura forjada → rejeitado e sem StripeEvent', async ({ request }) => {
    const fakeEventId = 'evt_pw_forged_001';
    await prisma.stripeEvent.deleteMany({ where: { eventId: fakeEventId } });

    const res = await request.post('/api/webhooks/stripe', {
      headers: { 'stripe-signature': 'forged-signature', 'content-type': 'application/json' },
      data: { id: fakeEventId, type: 'checkout.session.completed', data: { object: {} } },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);

    // Sem efeito colateral: o evento NÃO pode ter sido registrado.
    const persisted = await prisma.stripeEvent.count({ where: { eventId: fakeEventId } });
    expect(persisted).toBe(0);
  });

  test('POST /api/postback/lomadee sem token → 401', async ({ request }) => {
    const res = await request.post('/api/postback/lomadee', {
      data: { subId: 'x', orderId: 'ord-123', commissionValue: 10, status: 'CONFIRMED' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/postback/lomadee com token inválido → 401', async ({ request }) => {
    const res = await request.post('/api/postback/lomadee?token=forged', {
      headers: { 'content-type': 'application/json' },
      data: { unexpected: true },
    });
    expect(res.status()).toBe(401);
  });
});