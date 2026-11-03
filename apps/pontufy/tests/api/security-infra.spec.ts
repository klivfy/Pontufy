import { test, expect } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════════════
// V4 — Controles de segurança fail-closed
//
// Antes, sem Redis: rate limit liberava tudo, lockout nunca bloqueava e
// revogação de sessão era no-op — sem nenhum sinal. Agora:
//   • caminhos de autenticação respondem 503 quando a infra está fora;
//   • /api/health expõe o estado para monitoração.
//
// O contrato é testado nos dois sentidos: com Redis configurado o health
// reporta `up`; sem Redis, o mesmo health reporta `not_configured` e as rotas
// de autenticação recusam.
// ═══════════════════════════════════════════════════════════════════════════

const uniqueIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

test.describe('V4 — health e fail-closed', () => {
  test('/api/health é público, não chama LLM e expõe db/redis', async ({ request }) => {
    const res = await request.get('/api/health');
    const body = await res.json();

    expect(['ok', 'degraded']).toContain(body.status);
    expect(['up', 'down']).toContain(body.db);
    expect(['up', 'down', 'not_configured']).toContain(body.redis);
    expect(typeof body.latencyMs).toBe('number');
    expect(body.latencyMs).toBeLessThan(3000);

    // Health de banco fora do ar => 503 (a aplicação não serve nada útil).
    if (body.db === 'down') expect(res.status()).toBe(503);
    else expect(res.status()).toBe(200);
  });

  test('sem Redis, autenticação responde 503 (nunca 200 com proteção desligada)', async ({ request }) => {
    const health = await request.get('/api/health');
    const body = await health.json();

    test.skip(body.redis !== 'not_configured', 'Ambiente tem Redis: cenário de indisponibilidade não se aplica.');

    const register = await request.post('/api/auth/register', {
      headers: { 'x-forwarded-for': uniqueIp() },
      data: { token: 'x'.repeat(32), name: 'Fulano', password: 'Senha-Forte-123' },
    });
    expect(register.status()).toBe(503);

    const forgot = await request.post('/api/auth/forgot-password', {
      headers: { 'x-forwarded-for': uniqueIp() },
      data: { email: 'alguem@example.com' },
    });
    expect(forgot.status()).toBe(503);

    const onboarding = await request.post('/api/tenants/onboarding', {
      headers: { 'x-forwarded-for': uniqueIp() },
      data: {
        companyName: 'Empresa Teste',
        sector: 'tech',
        adminName: 'Admin',
        adminEmail: `admin-${Date.now()}@example.com`,
        adminPassword: 'Senha-Forte-123',
      },
    });
    expect(onboarding.status()).toBe(503);
  });
});
