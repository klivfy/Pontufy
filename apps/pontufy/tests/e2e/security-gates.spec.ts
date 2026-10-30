import { test, expect } from '@playwright/test';
import { USERS } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Barreiras de acesso na camada de UI (proxy.ts)
// /superadmin/* → 403 estrito para qualquer não-super_admin (sem redirect);
// /admin/* → admin_rh tem acesso, employee é redirecionado ao /dashboard.
// ═══════════════════════════════════════════════════════════════════════════

async function login(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('voce@empresa.com').fill(email);
  await page.getByPlaceholder('••••••••').fill('123456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/dashboard');
}

test.describe('Barreiras de UI', () => {
  for (const [label, email] of [
    ['employee', USERS.alphaEmployee],
    ['admin_rh', USERS.alphaAdmin],
    ['guest', USERS.alphaGuest],
  ] as const) {
    test(`/${label} → /superadmin responde 403 (sem redirecionamento)`, async ({ page }) => {
      await login(page, email);
      const response = await page.goto('/superadmin', { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(403);
      expect(page.url()).toContain('/superadmin');
    });
  }

  test('employee em /admin é redirecionado para /dashboard (sem 403/leak)', async ({ page }) => {
    await login(page, USERS.alphaEmployee);
    await page.goto('/admin');
    await page.waitForURL('**/dashboard');
    expect(page.url()).toContain('/dashboard');
  });

  test('guest em /admin é redirecionado para /dashboard', async ({ page }) => {
    await login(page, USERS.alphaGuest);
    await page.goto('/admin');
    await page.waitForURL('**/dashboard');
  });

  test('admin_rh acessa /admin/analytics normalmente (200)', async ({ page }) => {
    await login(page, USERS.alphaAdmin);
    const response = await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
  });

  test('não autenticado em /superadmin → 403 (sem vazamento da rota)', async ({ page }) => {
    const response = await page.goto('/superadmin', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(403);
  });

  test('/unlock-account é rota pública (não redireciona para /login)', async ({ page }) => {
    const response = await page.goto('/unlock-account', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    expect(page.url()).toContain('/unlock-account');
  });

  test('/verify é rota pública (não redireciona para /login)', async ({ page }) => {
    await page.goto('/verify/not-a-real-certificate', { waitUntil: 'domcontentloaded' });
    expect(page.url()).toContain('/verify/');
    expect(page.url()).not.toContain('/login');
  });
});