import { test, expect } from '@playwright/test';
import { prisma } from '../helpers/db';
import { logAudit, SYSTEM_TENANT_ID } from '../../src/lib/audit';

// ═══════════════════════════════════════════════════════════════════════════
// B5 — Auditoria com escopo de plataforma
//
// `AuditLog.tenantId` era NOT NULL: evento operacional (cron, provisionamento,
// ajuste de crédito) não tinha onde ser gravado — ou era gravado no tenant de
// um cliente, poluindo a trilha dele.
// ═══════════════════════════════════════════════════════════════════════════

const ACTION = 'TEST_B5_PLATFORM_EVENT';

test.describe('B5 — auditoria de plataforma', () => {
  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { action: ACTION } });
  });

  test('tenant `system` existe e é um tenant real', async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: SYSTEM_TENANT_ID },
      select: { id: true, slug: true, contractStatus: true },
    });

    expect(tenant, 'migração 20261103060000 deve criar o tenant system').toBeTruthy();
    expect(tenant?.slug).toBe('system');
    expect(tenant?.contractStatus).toBe('active');
  });

  test('evento sem tenantId vai para o tenant system, não para o cliente', async () => {
    await logAudit({
      action: ACTION,
      entity: 'Platform',
      entityId: 'cron:expire-points',
      newValue: { source: 'cron' },
    });

    const entry = await prisma.auditLog.findFirst({
      where: { action: ACTION },
      select: { tenantId: true, entity: true },
    });

    expect(entry?.tenantId).toBe(SYSTEM_TENANT_ID);
  });

  test('evento de cliente continua escopado no próprio tenant', async () => {
    await logAudit({
      tenantId: 'tenant-alpha-001',
      action: ACTION,
      entity: 'Course',
      entityId: 'course-lgpd-001',
    });

    const entry = await prisma.auditLog.findFirst({
      where: { action: ACTION, entity: 'Course' },
      select: { tenantId: true },
    });

    expect(entry?.tenantId).toBe('tenant-alpha-001');
  });

  test('auditoria crítica propaga o erro em vez de engolir', async () => {
    // tenantId inexistente viola a FK: é o jeito de forçar a falha.
    await expect(
      logAudit({
        tenantId: 'tenant-que-nao-existe',
        action: ACTION,
        entity: 'Course',
        entityId: 'x',
        critical: true,
      }),
    ).rejects.toBeTruthy();
  });

  test('auditoria best-effort continua silenciosa em falha', async () => {
    await expect(
      logAudit({
        tenantId: 'tenant-que-nao-existe',
        action: ACTION,
        entity: 'Course',
        entityId: 'y',
      }),
    ).resolves.toBeUndefined();
  });
});
