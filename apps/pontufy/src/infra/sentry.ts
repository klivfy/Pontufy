/**
 * Observabilidade de erros — configuração pura, sem importar o SDK.
 *
 * Motivo de existir separado: o SDK (`@sentry/nextjs`) só é carregado nos
 * arquivos `sentry.*.config.ts`, que rodam no processo do Next. Este módulo
 * pode ser importado por teste unitário e pela rota de health sem arrastar
 * dependência de browser/server.
 *
 * Regra: **sem `SENTRY_DSN`, nada é inicializado**. Observabilidade é opcional
 * por ambiente — o produto não pode deixar de subir porque o DSN não foi
 * configurado, e não deve enviar dado de cliente para um projeto que ninguém
 * está olhando.
 */

export type SentryRuntime = 'server' | 'edge' | 'client';

/** DSN configurado, ou `undefined`. Valor em branco conta como ausente. */
export function sentryDsn(): string | undefined {
  const dsn = (process.env.SENTRY_DSN ?? '').trim();
  return dsn.length > 0 ? dsn : undefined;
}

export function isSentryEnabled(): boolean {
  return sentryDsn() !== undefined;
}

/** Taxa de amostragem de performance. Erro é sempre 100%; tracing é opcional. */
export function tracesSampleRate(): number {
  const raw = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0');
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(raw, 1);
}

/** Chaves de header/campo que nunca podem sair daqui. */
const REDACTED_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-affiliate-signature',
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
];

const REDACTED = '[redacted]';

/** Esconde `token=`/`code=` em query string — links de reset carregam segredo. */
export function scrubUrl(url: string): string {
  try {
    const parsed = new URL(url, 'http://local');
    let changed = false;

    for (const key of [...parsed.searchParams.keys()]) {
      if (REDACTED_KEYS.some((secret) => key.toLowerCase().includes(secret))) {
        parsed.searchParams.set(key, REDACTED);
        changed = true;
      }
    }

    if (!changed) return url;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return url;
  }
}

type Dict = Record<string, unknown>;

function scrubDict(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubDict);
  if (!value || typeof value !== 'object') return value;

  const out: Dict = {};
  for (const [key, item] of Object.entries(value as Dict)) {
    out[key] = REDACTED_KEYS.includes(key.toLowerCase()) ? REDACTED : scrubDict(item);
  }
  return out;
}

/**
 * Remove credencial e dado pessoal de um evento antes do envio.
 *
 * O que motivou: as rotas carregam `Authorization: Bearer <token de sessão>`,
 * cookies de sessão e tokens de reset na query string. Sem isto, cada erro 500
 * de um usuário mandaria a sessão dele para um serviço de terceiro.
 */
export function scrubEvent<T extends Dict>(event: T): T {
  const cleaned: Dict = { ...event };

  if (typeof cleaned.request === 'object' && cleaned.request) {
    cleaned.request = scrubDict(cleaned.request);
  }
  if (typeof cleaned.extra === 'object' && cleaned.extra) {
    cleaned.extra = scrubDict(cleaned.extra);
  }
  if (typeof cleaned.contexts === 'object' && cleaned.contexts) {
    cleaned.contexts = scrubDict(cleaned.contexts);
  }

  return cleaned as T;
}

/** Opções comuns às três runtimes. `enabled` é redundante de propósito. */
export function baseSentryOptions(runtime: SentryRuntime) {
  return {
    dsn: sentryDsn(),
    enabled: isSentryEnabled(),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: tracesSampleRate(),
    // Não envia IP, cookies nem corpo por padrão.
    sendDefaultPii: false,
    // Sem isto, um evento sem DSN ainda monta o payload inteiro.
    attachStacktrace: true,
    initialScope: { tags: { runtime } },
  };
}
