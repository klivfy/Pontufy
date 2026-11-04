import { test, expect } from '@playwright/test';

import { prisma } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Contrato HTTP do worker do outbox.
//
// O domínio do outbox já era testado (`outbox.spec.ts`): claim atômico,
// backoff, esgotamento. O que NÃO era testado era o encanamento — e foi
// exatamente ele que quebrou em produção:
//
//   • a rota exportava só POST, e o Vercel Cron chama com GET;
//   • a rota não estava na agenda do `vercel.json`.
//
// Consequência: nenhum e-mail transacional saía — verificação de empresa e
// recuperação de senha incluídas. Empresa cadastrada ficava sem login e sem
// caminho de recuperação.
//
// Este spec fixa as duas coisas que dependem só das minhas ações:
//   1. GET existe e autentica por Bearer (e só por ele);
//   2. GET executa o handler e marca o evento como concluído.
// A agenda é coberta por `scripts/check-crons.mjs` (roda no CI).
// ═══════════════════════════════════════════════════════════════════════════

// Mesmo default do `playwright.config.ts` (webServer.env).
const CRON_SECRET = process.env.CRON_SECRET ?? 'test-only-cron-secret-0000000000000';
const WORKER_URL = '/api/cron/outbox-worker';

const createdIds: string[] = [];

test.afterEach(async () => {
  if (createdIds.length === 0) return;
  await prisma.outboxEvent.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
});

async function enqueueEmail(subject: string): Promise<string> {
  const event = await prisma.outboxEvent.create({
    data: {
      type: 'email.send',
      payload: { to: 'destinatario@teste.local', subject, html: '<p>corpo</p>' },
      // Folga de um minuto: o claim compara com o relógio do banco.
      availableAt: new Date(Date.now() - 60_000),
    },
    select: { id: true },
  });

  createdIds.push(event.id);
  return event.id;
}

test.describe('Worker do outbox — contrato HTTP', () => {
  test('GET sem Authorization → 401 (fail-closed)', async ({ request }) => {
    const res = await request.get(WORKER_URL);
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toBe('UNAUTHORIZED');
  });

  test('GET com segredo errado → 401', async ({ request }) => {
    const res = await request.get(WORKER_URL, {
      headers: { Authorization: 'Bearer segredo-errado-000000000' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET com o segredo do cron → 200 e processa o evento pendente', async ({ request }) => {
    const eventId = await enqueueEmail('smoke-get');

    const res = await request.get(WORKER_URL, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.processed).toBeGreaterThanOrEqual(1);

    const event = await prisma.outboxEvent.findUnique({
      where: { id: eventId },
      select: { status: true, attempts: true },
    });
    expect(event?.status).toBe('done');
    expect(event?.attempts).toBe(1);
  });

  test('POST continua aceito (disparo manual)', async ({ request }) => {
    const res = await request.post(WORKER_URL, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  test('a resposta não devolve destinatário nem corpo do e-mail', async ({ request }) => {
    await enqueueEmail('smoke-pii');

    const res = await request.get(WORKER_URL, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const raw = await res.text();

    // O payload sai do banco e vai para o provedor: não pode voltar no corpo
    // de uma resposta de diagnóstico.
    expect(raw).not.toContain('destinatario@teste.local');
    expect(raw).not.toContain('corpo');
  });
});
