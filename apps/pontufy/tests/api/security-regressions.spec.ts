import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { loginAs } from '../helpers/auth';
import { prisma, SEED, USERS, userIdByEmail } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Regressões de segurança — Fase 1 (bloqueadores)
//
// Cada teste reproduz um vetor que estava aberto antes da correção:
//   1. crons autenticados por header forjável `x-vercel-cron`;
//   2. webhook de afiliados fail-OPEN quando o segredo não existe;
//   3. webhook de afiliados aceitando `trackingId` inventado no corpo;
//   4. preço do resgate (`pointsCost`) controlado pelo cliente;
//   5. saldo de pontos indo a negativo sob concorrência.
//
// Os testes 2 e 3 dependem de `AFFILIATE_WEBHOOK_SECRET` no ambiente do
// servidor de teste; quando ausente, o comportamento esperado é 503 (fail-closed)
// e os cenários autenticados são pulados explicitamente.
// ═══════════════════════════════════════════════════════════════════════════

const AFFILIATE_SECRET = process.env.AFFILIATE_WEBHOOK_SECRET ?? '';
const CRON_SECRET = process.env.CRON_SECRET ?? '';

function signAffiliate(body: string, timestamp: string): string {
  return createHmac('sha256', AFFILIATE_SECRET).update(`${timestamp}.${body}`).digest('hex');
}

test.describe('Segurança — crons', () => {
  test('header x-vercel-cron NÃO autoriza cron (bypass removido)', async ({ request }) => {
    const res = await request.get('/api/cron/expire-points', {
      headers: { 'x-vercel-cron': '1' },
    });

    // Sem CRON_SECRET configurado o endpoint é fail-closed (503);
    // com segredo configurado, o header forjável deve dar 401.
    expect(CRON_SECRET ? 401 : 503).toBe(res.status());
  });

  test('Bearer inválido não autoriza cron', async ({ request }) => {
    const res = await request.get('/api/cron/expire-points', {
      headers: { authorization: 'Bearer chute-errado' },
    });
    expect(CRON_SECRET ? 401 : 503).toBe(res.status());
  });
});

test.describe('Segurança — webhook de afiliados', () => {
  test('é fail-closed: sem segredo configurado responde 503 (nunca 200)', async ({ request }) => {
    test.skip(Boolean(AFFILIATE_SECRET), 'AFFILIATE_WEBHOOK_SECRET configurado — cenário de fail-closed não se aplica.');

    const res = await request.post('/api/webhooks/affiliates', {
      data: { trackingId: 'x', orderId: 'y', status: 'approved', commissionValue: 999999 },
    });
    expect(res.status()).toBe(503);
  });

  test('rejeita payload sem assinatura', async ({ request }) => {
    test.skip(!AFFILIATE_SECRET, 'AFFILIATE_WEBHOOK_SECRET não configurado no ambiente de teste.');

    const res = await request.post('/api/webhooks/affiliates', {
      data: { trackingId: 'x', orderId: 'y', status: 'approved', commissionValue: 10 },
    });
    expect(res.status()).toBe(400); // MISSING_TIMESTAMP (nem chega à assinatura)
  });

  test('rejeita assinatura inválida', async ({ request }) => {
    test.skip(!AFFILIATE_SECRET, 'AFFILIATE_WEBHOOK_SECRET não configurado no ambiente de teste.');

    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await request.post('/api/webhooks/affiliates', {
      headers: { 'x-affiliate-timestamp': timestamp, 'x-affiliate-signature': 'deadbeef' },
      data: { trackingId: 'x', orderId: 'y', status: 'approved', commissionValue: 10 },
    });
    expect(res.status()).toBe(401);
  });

  test('trackingId inventado não gera crédito de pontos', async ({ request }) => {
    test.skip(!AFFILIATE_SECRET, 'AFFILIATE_WEBHOOK_SECRET não configurado no ambiente de teste.');

    const employeeId = await userIdByEmail(USERS.alphaPoor);
    const before = await prisma.user.findUnique({ where: { id: employeeId } });
    const commissionBefore = await prisma.commission.count();

    const payload = JSON.stringify({
      trackingId: `inventado_${Date.now()}`,
      orderId: `ord_forjado_${Date.now()}`,
      status: 'approved',
      commissionValue: 999999,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const res = await request.post('/api/webhooks/affiliates', {
      headers: {
        'x-affiliate-timestamp': timestamp,
        'x-affiliate-signature': signAffiliate(payload, timestamp),
        'content-type': 'application/json',
      },
      data: payload,
    });

    // Assinatura válida, mas a redenção não existe → nada é creditado.
    expect(res.status()).toBe(404);

    const after = await prisma.user.findUnique({ where: { id: employeeId } });
    expect(after?.pointsBalance).toBe(before?.pointsBalance);
    expect(await prisma.commission.count()).toBe(commissionBefore);
  });
});

test.describe('Segurança — preço do resgate', () => {
  test('pointsCost enviado pelo cliente é ignorado e não debita pontos', async ({ request }) => {
    await loginAs(request, USERS.alphaVip);
    const userId = await userIdByEmail(USERS.alphaVip);

    const before = await prisma.user.findUnique({ where: { id: userId } });
    const redemptionsBefore = await prisma.redemption.count({ where: { userId } });

    const res = await request.post('/api/rewards/redeem', {
      data: {
        productUrl: 'https://www.amazon.com.br/produto-de-teste',
        pointsCost: 1,
        productTitle: 'Produto qualquer',
      },
    });

    // O fluxo de produto é "abrir oferta" (não debita) ou rejeita a URL.
    expect([200, 400]).toContain(res.status());

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.pointsBalance, 'Cliente conseguiu definir o preço do resgate').toBe(
      before?.pointsBalance,
    );
    expect(await prisma.redemption.count({ where: { userId } })).toBe(redemptionsBefore);
  });

  test('saldo insuficiente → 400 e saldo intacto (nunca negativo)', async ({ request }) => {
    await loginAs(request, USERS.alphaPoor);
    const userId = await userIdByEmail(USERS.alphaPoor);

    const before = await prisma.user.findUnique({ where: { id: userId } });
    expect(before?.pointsBalance ?? 0).toBeLessThan(500);

    const res = await request.post('/api/rewards/redeem', {
      data: { rewardId: SEED.rewardAmazon }, // custa 500
    });
    expect(res.status()).toBe(400);

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.pointsBalance).toBe(before?.pointsBalance);
    expect(after?.pointsBalance ?? -1).toBeGreaterThanOrEqual(0);
  });

  test('5 resgates concorrentes com saldo para 1 → exatamente 1 resgate e saldo >= 0', async ({ request }) => {
    const userId = await userIdByEmail(USERS.alphaVip);
    await loginAs(request, USERS.alphaVip);

    const reward = await prisma.reward.findUnique({ where: { id: SEED.rewardAmazon } });
    expect(reward).not.toBeNull();
    const price = reward!.pricePoints;

    // Saldo exato para UMA unidade.
    await prisma.redemption.deleteMany({ where: { userId } });
    await prisma.pointsLedger.deleteMany({ where: { userId } });
    await prisma.user.update({ where: { id: userId }, data: { pointsBalance: price } });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request.post('/api/rewards/redeem', { data: { rewardId: SEED.rewardAmazon } }),
      ),
    );

    const statuses = responses.map((r) => r.status());
    const successes = statuses.filter((s) => s === 200).length;

    expect(successes, `Esperado 1 resgate bem-sucedido (status: ${statuses.join(',')})`).toBe(1);

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.pointsBalance ?? -1).toBe(0);
    expect(await prisma.redemption.count({ where: { userId } })).toBe(1);

    // Restaura o estado para os outros testes da suíte.
    await prisma.user.update({ where: { id: userId }, data: { pointsBalance: 2000 } });
  });
});
