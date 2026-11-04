import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emailTransport, isEmailDeliveryConfigured } from '../../src/infra/email';

// ═══════════════════════════════════════════════════════════════════════════
// Transporte de e-mail — a diferença entre "não configurado" e "enviado".
//
// O bug que motivou este teste: sem `RESEND_API_KEY`, o envio imprimia no
// console e retornava `true`. O outbox marcava o evento como entregue e o
// painel dizia que o e-mail saiu. Empresa nenhuma recebia o link de
// verificação, e nada indicava falha.
//
// A matriz abaixo é o contrato: em produção, ausência de provedor é `none` —
// quem chama PRECISA falhar, nunca assumir sucesso.
// ═══════════════════════════════════════════════════════════════════════════

const ENV_KEYS = ['RESEND_API_KEY', 'EMAIL_TRANSPORT', 'NODE_ENV'] as const;

// `process.env.NODE_ENV` é tipado como read-only pelo Next; o objeto por trás
// é mutável. O alias evita o cast repetido e deixa claro que o teste manipula
// o ambiente e restaura no `finally`.
const env = process.env as Record<string, string | undefined>;

function withEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => void) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));

  for (const key of ENV_KEYS) {
    const value = overrides[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

test('chave do Resend presente → transporte resend', () => {
  withEnv({ RESEND_API_KEY: 're_test_123', NODE_ENV: 'production' }, () => {
    assert.equal(emailTransport(), 'resend');
    assert.equal(isEmailDeliveryConfigured(), true);
  });
});

test('EMAIL_TRANSPORT=log vence a chave (teste e desenvolvimento)', () => {
  withEnv({ RESEND_API_KEY: 're_test_123', EMAIL_TRANSPORT: 'log', NODE_ENV: 'production' }, () => {
    assert.equal(emailTransport(), 'log');
    assert.equal(isEmailDeliveryConfigured(), true);
  });
});

test('sem chave e fora de produção → log, não falha', () => {
  withEnv({ RESEND_API_KEY: undefined, EMAIL_TRANSPORT: undefined, NODE_ENV: 'development' }, () => {
    assert.equal(emailTransport(), 'log');
    assert.equal(isEmailDeliveryConfigured(), true);
  });
});

test('sem chave EM PRODUÇÃO → none (nada é entregue, e isso é explícito)', () => {
  withEnv({ RESEND_API_KEY: undefined, EMAIL_TRANSPORT: undefined, NODE_ENV: 'production' }, () => {
    assert.equal(emailTransport(), 'none');
    assert.equal(isEmailDeliveryConfigured(), false);
  });
});

test('EMAIL_TRANSPORT com valor desconhecido não vira log silencioso', () => {
  withEnv({ RESEND_API_KEY: undefined, EMAIL_TRANSPORT: 'smtp', NODE_ENV: 'production' }, () => {
    // Valor não reconhecido é ignorado: a decisão volta a ser "tem chave?".
    assert.equal(emailTransport(), 'none');
  });
});
