import { test, expect } from '@playwright/test';
import { prisma, USERS } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Painel de Analytics HR + White-label (branding do tenant)
// Admin da Empresa Alpha acessa o painel, gráficos renderizam (recharts),
// o tema escuro é aplicado e o branding do tenant está configurado.
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analytics e white-label (admin_rh)', () => {
  test.setTimeout(90_000);

  test('admin vê o painel de analytics com tema escuro e gráficos', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('voce@empresa.com').fill(USERS.alphaAdmin);
    await page.getByPlaceholder('••••••••').fill('123456');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/dashboard');

    await page.goto('/admin/analytics');
    await expect(page.getByRole('heading', { name: /Painel de Analytics/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('div.bg-\\[\\#0a0a0a\\]').first()).toBeVisible();

    // KPIs e gráficos recharts renderizados após o fetch de /api/admin/analytics.
    await expect(page.getByText('Colaboradores Ativos')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 20_000 });
  });

  test('white-label: branding do tenant configurado (API + banco)', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('voce@empresa.com').fill(USERS.alphaAdmin);
    await page.getByPlaceholder('••••••••').fill('123456');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/dashboard');

    const res = await page.request.get('/api/admin/tenant/branding');
    expect(res.status()).toBe(200);
    const branding = await res.json();
    expect(branding.name).toBe('Empresa Alpha');

    const tenant = await prisma.tenant.findUnique({
      where: { slug: 'empresa-alpha' },
      select: { primaryColor: true, accentColor: true, logoUrl: true },
    });
    expect(tenant?.primaryColor).toBe('#495453');
    expect(tenant?.accentColor).toBe('#A7E3C1');
  });

  test('PATCH de branding: admin_rh pode; employee recebe 403', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('voce@empresa.com').fill(USERS.alphaAdmin);
    await page.getByPlaceholder('••••••••').fill('123456');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/dashboard');

    const ok = await page.request.patch('/api/admin/tenant/branding', {
      data: { logoUrl: null },
    });
    expect(ok.status()).toBe(200);

    // Employee não pode alterar branding.
    await page.goto('/login');
    await page.getByPlaceholder('voce@empresa.com').fill(USERS.alphaEmployee);
    await page.getByPlaceholder('••••••••').fill('123456');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/dashboard');
    const denied = await page.request.patch('/api/admin/tenant/branding', {
      data: { logoUrl: 'https://evil.example/x.png' },
    });
    expect(denied.status()).toBe(403);
  });
});