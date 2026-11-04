import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { loginAs } from '../helpers/auth';
import { prisma, USERS } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Ativação manual de empresa — a saída de emergência do suporte.
//
// O buraco que isto fecha: o tenant nasce em `pending_verification`, o login é
// bloqueado por design e a única liberação era o link enviado por e-mail. Com
// o worker do outbox parado, nenhum e-mail saía — e não havia como liberar a
// empresa por nenhum outro caminho. O cliente ficava preso e o suporte não
// tinha ferramenta.
//
// O que este spec prova:
//   • a empresa nasce bloqueada e sem créditos;
//   • o superadmin consegue ativar, com créditos de trial e trilha de auditoria;
//   • repetir não duplica créditos;
//   • o link que chegar DEPOIS não concede de novo;
//   • quem não é super_admin não ativa;
//   • motivo curto é recusado.
// ═══════════════════════════════════════════════════════════════════════════

const dayKey = () => new Date().toISOString().slice(0, 10);

const hasRedis = () =>
  Boolean(process.env.UPSTASH_REDIS_REST_URL) && Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

const uniqueIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

function onboardingPayload(email: string) {
  return {
    companyName: `Empresa Ativacao ${randomUUID().slice(0, 8)}`,
    sector: 'tech',
    adminName: 'Admin Ativacao',
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

/** Cria uma empresa pelo caminho público e devolve id + e-mail. */
async function createPendingTenant(request: APIRequestContext) {
  const email = `ativacao-${Date.now()}-${randomUUID().slice(0, 6)}@example.com`;

  await prisma.provisioningQuota.deleteMany({ where: { day: dayKey() } });

  const res = await request.post('/api/tenants/onboarding', {
    headers: { 'x-forwarded-for': uniqueIp() },
    data: onboardingPayload(email),
  });

  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();

  return { tenantId: body.tenantId as string, email };
}

test.describe('Ativação manual de empresa', () => {
  test.skip(!hasRedis(), 'Provisionamento é fail-closed sem Redis (V4) — configure UPSTASH_* para rodar.');

  test('empresa pendente é ativada pelo superadmin com créditos e auditoria', async ({ request }) => {
    const { tenantId, email } = await createPendingTenant(request);

    try {
      const before = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { contractStatus: true, aiCredits: true },
      });
      expect(before?.contractStatus).toBe('pending_verification');
      expect(before?.aiCredits).toBe(0);

      // Sessão do superadmin substitui o cookie anônimo usado na criação.
      await loginAs(request, USERS.superAdmin);

      const res = await request.post(`/api/superadmin/tenants/${tenantId}/activate`, {
        data: { reason: 'E-mail de verificação não chegou — cliente no telefone, urgência.' },
      });
      expect(res.status(), await res.text()).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.alreadyActive).toBe(false);
      expect(body.creditsGranted).toBe(20);

      const after = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { contractStatus: true, aiCredits: true },
      });
      expect(after?.contractStatus).toBe('active');
      expect(after?.aiCredits).toBe(20);

      // O link que chegasse depois não pode conceder de novo.
      const pendingLinks = await prisma.emailVerification.count({
        where: { email, usedAt: null },
      });
      expect(pendingLinks, 'convites de verificação devem ser consumidos').toBe(0);

      const audit = await prisma.auditLog.findFirst({
        where: { tenantId, action: 'TENANT_ACTIVATED_MANUALLY' },
        orderBy: { createdAt: 'desc' },
        select: { newValue: true },
      });
      expect(audit, 'ativação manual precisa de trilha').not.toBeNull();
      expect(JSON.stringify(audit?.newValue)).toContain('E-mail de verificação não chegou');

      // Idempotência: repetir não duplica créditos.
      const again = await request.post(`/api/superadmin/tenants/${tenantId}/activate`, {
        data: { reason: 'Segunda chamada — suporte conferindo o estado.' },
      });
      expect(again.status(), await again.text()).toBe(200);

      const againBody = await again.json();
      expect(againBody.alreadyActive).toBe(true);
      expect(againBody.creditsGranted).toBe(0);

      const credits = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { aiCredits: true },
      });
      expect(credits?.aiCredits, 'ativação repetida não duplica créditos').toBe(20);
    } finally {
      await cleanupTenantByEmail(email);
    }
  });

  test('motivo curto é recusado (400) e não ativa', async ({ request }) => {
    const { tenantId, email } = await createPendingTenant(request);

    try {
      await loginAs(request, USERS.superAdmin);

      const res = await request.post(`/api/superadmin/tenants/${tenantId}/activate`, {
        data: { reason: 'curto' },
      });
      expect(res.status(), await res.text()).toBe(400);

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { contractStatus: true },
      });
      expect(tenant?.contractStatus).toBe('pending_verification');
    } finally {
      await cleanupTenantByEmail(email);
    }
  });

  test('admin_rh e employee não ativam empresa (403 estrito)', async ({ request }) => {
    const { tenantId, email } = await createPendingTenant(request);

    try {
      for (const who of [USERS.alphaAdmin, USERS.alphaEmployee]) {
        await loginAs(request, who);

        const res = await request.post(`/api/superadmin/tenants/${tenantId}/activate`, {
          data: { reason: 'Tentativa de escalada por papel não autorizado.' },
        });
        expect(res.status(), `${who} deveria receber 403`).toBe(403);
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { contractStatus: true },
      });
      expect(tenant?.contractStatus).toBe('pending_verification');
    } finally {
      await cleanupTenantByEmail(email);
    }
  });

  test('tenant inexistente → 404', async ({ request }) => {
    await loginAs(request, USERS.superAdmin);

    const res = await request.post(`/api/superadmin/tenants/${randomUUID()}/activate`, {
      data: { reason: 'Verificando resposta para id inexistente.' },
    });
    expect(res.status()).toBe(404);
  });
});
