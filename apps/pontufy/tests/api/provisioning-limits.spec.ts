import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// V3 — Provisionamento unificado de tenant
//
// Antes: qualquer login Google com e-mail desconhecido criava empresa com
// trial e 20 créditos de IA, sem limite e sem verificação. O formulário
// público era o único caminho com controle.
//
// Agora: todo tenant nasce em `provisionTenant`, em `pending_verification` e
// com 0 créditos; a ativação e os créditos vêm da confirmação de e-mail.
// ═══════════════════════════════════════════════════════════════════════════

const dayKey = () => new Date().toISOString().slice(0, 10);

// O provisionamento é um caminho de autenticação e passou a ser fail-closed
// sem Redis (V4): sem infra de contagem, /api/tenants/onboarding responde 503.
const hasRedis = () =>
  Boolean(process.env.UPSTASH_REDIS_REST_URL) && Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

/** IP único por requisição: o rate limit por IP é por bucket e a suíte roda várias vezes. */
const uniqueIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

function onboardingPayload(email: string) {
  return {
    companyName: `Empresa E2E ${randomUUID().slice(0, 8)}`,
    sector: 'tech',
    adminName: 'Admin E2E',
    adminEmail: email,
    adminPassword: 'Senha-Forte-123',
  };
}

async function cleanupTenantByEmail(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, tenantId: true },
  });
  if (!user) return;

  await prisma.emailVerification.deleteMany({ where: { email } });
  await prisma.auditLog.deleteMany({ where: { tenantId: user.tenantId } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.tenant.delete({ where: { id: user.tenantId } }).catch(() => {});
}

test.describe('V3 — provisionamento de tenant', () => {
  test.skip(!hasRedis(), 'Provisionamento é fail-closed sem Redis (V4) — configure UPSTASH_* para rodar.');

  test('empresa nasce pendente, com 0 créditos, e só ativa após confirmar o e-mail', async ({ request }) => {
    const email = `provision-flow-${Date.now()}@example.com`;
    const ip = uniqueIp();

    // A cota diária é global; em banco de teste ela é zerada para o teste ser
    // determinístico (o teto em si tem teste próprio abaixo).
    await prisma.provisioningQuota.deleteMany({ where: { day: dayKey() } });

    try {
      const createRes = await request.post('/api/tenants/onboarding', {
        headers: { 'x-forwarded-for': ip },
        data: onboardingPayload(email),
      });
      expect(createRes.status(), await createRes.text()).toBe(201);

      const created = await createRes.json();
      expect(created.verificationRequired).toBe(true);

      const pendingTenant = await prisma.tenant.findUnique({
        where: { id: created.tenantId },
        select: { contractStatus: true, aiCredits: true },
      });
      expect(pendingTenant?.contractStatus).toBe('pending_verification');
      expect(pendingTenant?.aiCredits, 'empresa não verificada não recebe créditos').toBe(0);

      const verification = await prisma.emailVerification.findFirst({
        where: { email },
        select: { token: true, usedAt: true },
      });
      expect(verification, 'token de verificação deve existir').not.toBeNull();
      expect(verification?.usedAt).toBeNull();

      // Confirmação
      const verifyRes = await request.post('/api/tenants/verify', {
        headers: { 'x-forwarded-for': uniqueIp() },
        data: { token: verification!.token },
      });
      expect(verifyRes.status(), await verifyRes.text()).toBe(200);

      const activeTenant = await prisma.tenant.findUnique({
        where: { id: created.tenantId },
        select: { contractStatus: true, aiCredits: true },
      });
      expect(activeTenant?.contractStatus).toBe('active');
      expect(activeTenant?.aiCredits, 'créditos do trial liberados na confirmação').toBe(20);

      // Uso único: repetir não libera de novo.
      const reuseRes = await request.post('/api/tenants/verify', {
        headers: { 'x-forwarded-for': uniqueIp() },
        data: { token: verification!.token },
      });
      expect(reuseRes.status()).toBe(409);

      const stillActive = await prisma.tenant.findUnique({
        where: { id: created.tenantId },
        select: { aiCredits: true },
      });
      expect(stillActive?.aiCredits, 'confirmação repetida não duplica créditos').toBe(20);
    } finally {
      await cleanupTenantByEmail(email);
    }
  });

  test('e-mail já cadastrado é recusado antes de criar qualquer tenant', async ({ request }) => {
    const email = `provision-dup-${Date.now()}@example.com`;

    await prisma.provisioningQuota.deleteMany({ where: { day: dayKey() } });
    const first = await request.post('/api/tenants/onboarding', {
      headers: { 'x-forwarded-for': uniqueIp() },
      data: onboardingPayload(email),
    });
    expect(first.status(), await first.text()).toBe(201);

    try {
      const second = await request.post('/api/tenants/onboarding', {
        headers: { 'x-forwarded-for': uniqueIp() },
        data: onboardingPayload(email),
      });
      expect(second.status()).toBe(409);

      const users = await prisma.user.count({ where: { email } });
      expect(users).toBe(1);
    } finally {
      await cleanupTenantByEmail(email);
    }
  });

  test('token inválido não ativa nada', async ({ request }) => {
    const res = await request.post('/api/tenants/verify', {
      headers: { 'x-forwarded-for': uniqueIp() },
      data: { token: 'a'.repeat(64) },
    });
    expect(res.status()).toBe(404);
  });

  // O teto diário só pode ser exercitado com a variável de ambiente definida
  // no servidor de teste (a suíte sobe um único servidor).
  test('teto diário de tenants bloqueia a criação seguinte', async ({ request }) => {
    test.skip(
      !process.env.PROVISION_MAX_TENANTS_PER_DAY,
      'Defina PROVISION_MAX_TENANTS_PER_DAY no ambiente do servidor para exercitar o teto.',
    );

    const cap = Number(process.env.PROVISION_MAX_TENANTS_PER_DAY);
    await prisma.provisioningQuota.upsert({
      where: { day: dayKey() },
      create: { day: dayKey(), tenants: cap, aiCredits: 0 },
      update: { tenants: cap },
    });

    const email = `provision-cap-${Date.now()}@example.com`;
    try {
      const res = await request.post('/api/tenants/onboarding', {
        headers: { 'x-forwarded-for': uniqueIp() },
        data: onboardingPayload(email),
      });
      expect(res.status()).toBe(429);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    } finally {
      await prisma.provisioningQuota.deleteMany({ where: { day: dayKey() } });
      await cleanupTenantByEmail(email);
    }
  });
});
