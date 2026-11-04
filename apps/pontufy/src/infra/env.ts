import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// Validação de ambiente no boot (F2.6)
//
// Antes, cada módulo lia `process.env` com o próprio fallback. O resultado era
// configuração errada descoberta em runtime, no meio de uma requisição:
//   • `certificate-generator` assinava com um segredo default público;
//   • `webhooks/affiliates` aceitava postback anônimo sem o segredo;
//   • `cron/*` aceitava header forjável;
//   • `db.ts` subia sem connection string e só falhava na primeira query.
//
// Aqui a validação é única, agregada e no start do servidor:
//   • produção → qualquer problema ABORTA o boot (fail-fast, com a lista toda);
//   • desenvolvimento → apenas avisa, para não travar o `next dev` de quem ainda
//     não configurou tudo.
//
// Chamado por `src/instrumentation.ts` (runtime nodejs, nunca no build).
// ═══════════════════════════════════════════════════════════════════════════

const MIN_SECRET_LENGTH = 32;

const optionalUrl = z.string().url().optional();

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Banco — mesmos aliases aceitos por `src/infra/db.ts`.
  DATABASE_URL: optionalUrl,
  POSTGRES_PRISMA_URL: optionalUrl,
  POSTGRES_URL: optionalUrl,
  SUPABASE_DATABASE_URL: optionalUrl,
  KLIV_PONT_POSTGRES_PRISMA_URL: optionalUrl,
  KLIV_PONT_POSTGRES_URL: optionalUrl,

  // Segurança — obrigatórios em produção.
  AUTH_SECRET: z.string().min(MIN_SECRET_LENGTH, `mínimo ${MIN_SECRET_LENGTH} caracteres`).optional(),
  CRON_SECRET: z.string().min(16, 'mínimo 16 caracteres').optional(),
  AFFILIATE_WEBHOOK_SECRET: z.string().min(16, 'mínimo 16 caracteres').optional(),
  LOMADEE_POSTBACK_SECRET: z.string().min(16, 'mínimo 16 caracteres').optional(),
  CERTIFICATE_VERIFICATION_SECRET: z
    .string()
    .min(MIN_SECRET_LENGTH, `mínimo ${MIN_SECRET_LENGTH} caracteres`)
    .optional(),

  // Integrações — degradam, mas exigem par completo quando presentes.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Chaves que impedem a aplicação de subir em produção. */
const PRODUCTION_REQUIRED = [
  'AUTH_SECRET',
  'CRON_SECRET',
  'AFFILIATE_WEBHOOK_SECRET',
  'LOMADEE_POSTBACK_SECRET',
  'CERTIFICATE_VERIFICATION_SECRET',
] as const;

const DATABASE_KEYS = [
  'DATABASE_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'SUPABASE_DATABASE_URL',
  'KLIV_PONT_POSTGRES_PRISMA_URL',
  'KLIV_PONT_POSTGRES_URL',
] as const;

let validated = false;

export interface EnvReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function collectWarnings(env: Partial<ServerEnv>): string[] {
  const warnings: string[] = [];

  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    warnings.push(
      'Upstash Redis ausente: rate limit, account lockout, revogação de sessão e SSE ficam desativados.',
    );
  }

  if (Boolean(env.STRIPE_SECRET_KEY) !== Boolean(env.STRIPE_WEBHOOK_SECRET)) {
    warnings.push('STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET devem ser configurados juntos.');
  }

  return warnings;
}

/**
 * Valida o ambiente. Exportado para testes e para `instrumentation.ts`.
 * Nunca lança: devolve o relatório e cabe ao chamador decidir abortar.
 */
export function validateServerEnv(raw: NodeJS.ProcessEnv = process.env): EnvReport {
  const parsed = serverEnvSchema.safeParse(raw);
  const errors: string[] = [];

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.') || 'env'}: ${issue.message}`);
    }
  }

  const env = (parsed.success ? parsed.data : raw) as Partial<ServerEnv>;
  const isProduction = env.NODE_ENV === 'production';

  const hasDatabase = DATABASE_KEYS.some((key) => Boolean(raw[key]));
  if (!hasDatabase) {
    const message = `Nenhuma connection string de banco configurada (${DATABASE_KEYS.join(', ')}).`;
    if (isProduction) errors.push(message);
    else errors.push(`[dev] ${message}`);
  }

  if (isProduction) {
    for (const key of PRODUCTION_REQUIRED) {
      if (!raw[key]) errors.push(`${key} ausente (obrigatório em produção).`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings: collectWarnings(env),
  };
}

/**
 * Valida e, em produção, aborta o processo. Em desenvolvimento apenas loga.
 * Idempotente: só roda uma vez por processo.
 */
export function assertServerEnv(): EnvReport {
  if (validated) return { ok: true, errors: [], warnings: [] };
  validated = true;

  const report = validateServerEnv();
  const isProduction = process.env.NODE_ENV === 'production';

  for (const warning of report.warnings) {
    console.warn(`[env] ⚠️  ${warning}`);
  }

  if (report.ok) {
    console.log('[env] ✅ Ambiente validado.');
    return report;
  }

  if (!isProduction) {
    // Em dev não derrubamos o servidor: o objetivo é dar visibilidade.
    console.warn('[env] ⚠️  Problemas de configuração (ignorados em desenvolvimento):');
    for (const error of report.errors) console.warn(`[env]    - ${error}`);
    return report;
  }

  console.error('[env] 🔴 Configuração inválida — abortando o boot:');
  for (const error of report.errors) console.error(`[env]    - ${error}`);
  throw new Error(
    `[env] ${report.errors.length} problema(s) de configuração. Corrija as variáveis acima antes de subir.`,
  );
}
