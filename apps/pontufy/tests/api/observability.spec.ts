import { test, expect } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════════════
// B1 — requestId na resposta
//
// Sem isso, um erro reportado pelo usuário ("deu erro interno") não é
// rastreável até as linhas de log daquela requisição. O proxy gera ou reusa
// o id e o devolve no cabeçalho.
// ═══════════════════════════════════════════════════════════════════════════

const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

test.describe('B1 — observabilidade', () => {
  test('página pública devolve x-request-id na resposta', async ({ request }) => {
    const response = await request.get('/login', { maxRedirects: 0 });

    const requestId = response.headers()['x-request-id'];
    expect(requestId, 'x-request-id ausente: log não é correlacionável').toBeTruthy();
    expect(requestId).toMatch(ID_PATTERN);
  });

  test('id enviado pela borda é preservado (correlação ponta a ponta)', async ({ request }) => {
    const inbound = 'borda-request-id-1234567890';

    const response = await request.get('/login', {
      headers: { 'x-request-id': inbound },
      maxRedirects: 0,
    });

    expect(response.headers()['x-request-id']).toBe(inbound);
  });

  test('id malformado é descartado e substituído (não vira header injection)', async ({ request }) => {
    const response = await request.get('/login', {
      headers: { 'x-request-id': 'curto' },
      maxRedirects: 0,
    });

    const requestId = response.headers()['x-request-id'];
    expect(requestId).toBeTruthy();
    expect(requestId).not.toBe('curto');
    expect(requestId).toMatch(ID_PATTERN);
  });

  test('redirect para login também carrega o id (erro em rota protegida é rastreável)', async ({ request }) => {
    const response = await request.get('/admin', { maxRedirects: 0 });

    expect([302, 307]).toContain(response.status());
    expect(response.headers()['x-request-id']).toMatch(ID_PATTERN);
  });
});
