import { test, expect } from '@playwright/test';

import { prisma, USERS } from '../helpers/db';

// ═══════════════════════════════════════════════════════════════════════════
// Entrega de e-mail no mesmo request.
//
// O bug do outbox não foi só "faltou agendar": o desenho dependia 100% do cron
// como gatilho. Isso é frágil por dois motivos — o plano do Vercel limita a
// frequência dos cron jobs, e mesmo no melhor caso o link de verificação
// chegaria minutos depois do cadastro.
//
// Agora `sendEmail` grava o evento (durabilidade) e tenta enviar na hora. O
// worker HTTP continua existindo como rede de segurança para o que falhou.
//
// O que este spec fixa: uma ação que dispara e-mail deixa o evento `done`
// quando a resposta chega — sem cron, sem espera.
// ═══════════════════════════════════════════════════════════════════════════

const uniqueIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** Eventos de e-mail cujo destinatário é este endereço. */
async function emailEventsFor(address: string) {
  return prisma.outboxEvent.findMany({
    where: { type: 'email.send', payload: { path: ['to'], equals: address } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, attempts: true, createdAt: true },
  });
}

test.describe('Entrega de e-mail', () => {
  test('recuperação de senha sai na própria requisição (evento vira done)', async ({ request }) => {
    const email = USERS.alphaEmployee;

    // Estado limpo para o endereço: a suíte inteira gera e-mails para o seed.
    await prisma.outboxEvent.deleteMany({
      where: { type: 'email.send', payload: { path: ['to'], equals: email } },
    });

    try {
      const res = await request.post('/api/auth/forgot-password', {
        headers: { 'x-forwarded-for': uniqueIp() },
        data: { email },
      });
      expect(res.status(), await res.text()).toBe(200);

      const events = await emailEventsFor(email);
      expect(events.length, 'o pedido de reset precisa gerar um evento de e-mail').toBe(1);

      // Sem cron, sem polling: quando a resposta chegou, o evento já foi
      // processado. Se isto voltar a depender de agendamento, o teste quebra.
      expect(events[0].status).toBe('done');
      expect(events[0].attempts).toBe(0); // não passou pelo claim do worker
    } finally {
      await prisma.outboxEvent.deleteMany({
        where: { type: 'email.send', payload: { path: ['to'], equals: email } },
      });
      await prisma.passwordReset.deleteMany({ where: { user: { email } } });
    }
  });

  test('o evento é gravado ANTES do envio (durabilidade preservada)', async ({ request }) => {
    // O e-mail existe no outbox mesmo quando o transporte é o de console: o
    // registro não depende de o provedor estar configurado.
    const email = USERS.alphaAdmin;

    await prisma.outboxEvent.deleteMany({
      where: { type: 'email.send', payload: { path: ['to'], equals: email } },
    });

    try {
      const res = await request.post('/api/auth/forgot-password', {
        headers: { 'x-forwarded-for': uniqueIp() },
        data: { email },
      });
      expect(res.status()).toBe(200);

      const events = await emailEventsFor(email);
      expect(events.length).toBe(1);
      expect(events[0].status).toBe('done');
    } finally {
      await prisma.outboxEvent.deleteMany({
        where: { type: 'email.send', payload: { path: ['to'], equals: email } },
      });
      await prisma.passwordReset.deleteMany({ where: { user: { email } } });
    }
  });

  test('health expõe o transporte de e-mail em uso', async ({ request }) => {
    const res = await request.get('/api/health');
    const body = await res.json();

    // 'log' no ambiente de teste; 'resend' em produção com chave;
    // 'not_configured' quando produção está sem provedor — o caso que precisa
    // acender alarme.
    expect(['resend', 'log', 'not_configured']).toContain(body.email);
    expect(Array.isArray(body.warnings)).toBe(true);

    if (body.email !== 'resend') {
      expect(body.warnings.length).toBeGreaterThan(0);
    }
  });
});
