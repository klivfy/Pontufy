import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isSentryEnabled,
  scrubEvent,
  scrubUrl,
  sentryDsn,
  tracesSampleRate,
} from '../../src/infra/sentry';

// ═══════════════════════════════════════════════════════════════════════════
// Observabilidade — o que sai e o que fica.
//
// Duas garantias que valem teste:
//   1. sem `SENTRY_DSN` nada é inicializado (produto sobe sem observabilidade);
//   2. credencial não vaza para o serviço de terceiro. As rotas carregam
//      `Authorization: Bearer`, cookies de sessão e token de reset na query
//      string — um 500 sem scrub mandaria a sessão do usuário embora.
// ═══════════════════════════════════════════════════════════════════════════

const env = process.env as Record<string, string | undefined>;

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, env[key]]));

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

test('sem DSN, observabilidade fica desligada', () => {
  withEnv({ SENTRY_DSN: undefined }, () => {
    assert.equal(sentryDsn(), undefined);
    assert.equal(isSentryEnabled(), false);
  });
});

test('DSN em branco conta como ausente', () => {
  withEnv({ SENTRY_DSN: '   ' }, () => {
    assert.equal(isSentryEnabled(), false);
  });
});

test('DSN preenchido liga a captura', () => {
  withEnv({ SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1' }, () => {
    assert.equal(isSentryEnabled(), true);
    assert.equal(sentryDsn(), 'https://abc@o1.ingest.sentry.io/1');
  });
});

test('taxa de tracing é limitada a [0,1] e ignora lixo', () => {
  withEnv({ SENTRY_TRACES_SAMPLE_RATE: '2' }, () => assert.equal(tracesSampleRate(), 1));
  withEnv({ SENTRY_TRACES_SAMPLE_RATE: '-1' }, () => assert.equal(tracesSampleRate(), 0));
  withEnv({ SENTRY_TRACES_SAMPLE_RATE: 'abc' }, () => assert.equal(tracesSampleRate(), 0));
  withEnv({ SENTRY_TRACES_SAMPLE_RATE: '0.25' }, () => assert.equal(tracesSampleRate(), 0.25));
  withEnv({ SENTRY_TRACES_SAMPLE_RATE: undefined }, () => assert.equal(tracesSampleRate(), 0));
});

test('URL com token de reset é reescrita', () => {
  const scrubbed = scrubUrl('https://app.pontufy.com/reset-password?token=abc123&email=x@y.z');
  assert.ok(!scrubbed.includes('abc123'), `token vazou: ${scrubbed}`);
  assert.ok(scrubbed.includes('reset-password'));
});

test('URL sem segredo é devolvida intacta', () => {
  const url = 'https://app.pontufy.com/dashboard?tab=cursos';
  assert.equal(scrubUrl(url), url);
});

test('headers de credencial são redigidos em request', () => {
  const event = {
    message: 'boom',
    request: {
      url: 'https://app.pontufy.com/api/courses',
      headers: {
        authorization: 'Bearer segredo-de-sessao',
        cookie: 'authjs.session-token=abc',
        'content-type': 'application/json',
      },
    },
  };

  const cleaned = scrubEvent(event);
  const headers = (cleaned.request as { headers: Record<string, string> }).headers;

  assert.equal(headers.authorization, '[redacted]');
  assert.equal(headers.cookie, '[redacted]');
  assert.equal(headers['content-type'], 'application/json');
  assert.ok(!JSON.stringify(cleaned).includes('segredo-de-sessao'));
});

test('scrub é profundo em extra e contexts', () => {
  const cleaned = scrubEvent({
    extra: { password: 'senha-do-usuario', ok: 'visivel' },
    contexts: { session: { token: 'tok_123', user: 'joao' } },
  });

  assert.ok(!JSON.stringify(cleaned).includes('senha-do-usuario'));
  assert.ok(!JSON.stringify(cleaned).includes('tok_123'));
  assert.ok(JSON.stringify(cleaned).includes('visivel'));
  assert.ok(JSON.stringify(cleaned).includes('joao'));
});
