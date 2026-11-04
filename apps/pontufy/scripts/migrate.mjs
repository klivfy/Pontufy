// Applies pending Prisma migrations during the build, portably and resiliently.
//
// Why a script instead of `prisma migrate deploy` inline in the build command:
//  1. Portability — it does not depend on POSIX shell `${VAR:-default}` expansion,
//     which is not guaranteed in every CI/build shell.
//  2. `directUrl` fallback — Prisma validates DIRECT_URL whenever the schema
//     references it; here it defaults to DATABASE_URL so a single connection
//     string is enough for the common case.
//  3. Fail-soft — a migration failure (e.g. DATABASE_URL is a transaction-mode
//     pooler that can't run DDL) must NOT break the deploy. We warn loudly and
//     let `next build` proceed; the operator then sets DIRECT_URL (direct
//     endpoint) or runs `npm run db:migrate` once.
import { execSync } from 'node:child_process';

// Vercel / Supabase may inject the connection strings under different names
// depending on how the integration is configured — resolve with fallbacks.
// Canonical names first (local `.env.local`), then unprefixed, then KLIV_PONT_*.
const POOLED_URL_KEYS = [
  'DATABASE_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'SUPABASE_DATABASE_URL',
  'KLIV_PONT_POSTGRES_PRISMA_URL',
  'KLIV_PONT_POSTGRES_URL',
];

const DIRECT_URL_KEYS = [
  'DIRECT_URL',
  'POSTGRES_URL_NON_POOLING',
  'SUPABASE_DIRECT_URL',
  'KLIV_PONT_POSTGRES_URL_NON_POOLING',
];

function firstDefinedEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return { value, source: key };
  }
  return {};
}

const pooled = firstDefinedEnv(POOLED_URL_KEYS);
const direct = firstDefinedEnv(DIRECT_URL_KEYS);
const databaseUrl = pooled.value;
const directUrl = direct.value;

if (!databaseUrl) {
  console.warn(
    '\n🟠 No PostgreSQL connection string is set — skipping migrations. Set ' +
      'one of: ' +
      POOLED_URL_KEYS.join(', ') +
      ' to apply the schema.\n',
  );
  process.exit(0);
}

// Log only the variable NAMES that resolved — never the values (secrets).
console.log(
  `🔌 migrate: DATABASE_URL <- \`${pooled.source}\` | DIRECT_URL <- \`${direct.source ?? 'unset'}\``,
);

// Prisma migrate uses directUrl; fall back to the main URL when unset. Resolved
// values are passed explicitly so `prisma migrate deploy` picks them up no
// matter which variable names the platform provides.
const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: directUrl || databaseUrl };

// ── Fail-closed (F2.7) ──────────────────────────────────────────────────────
// Antes este script engolia a falha e deixava o build continuar: o deploy
// ficava VERDE com o schema defasado e o app quebrava em runtime ("column does
// not exist") — inclusive com a migração marcada como `failed` em
// `_prisma_migrations`, o que passa a travar todos os deploys seguintes em
// silêncio. Agora a falha aborta com exit 1 e mensagem acionável.
//
// Este script NÃO roda mais dentro do `next build`: `npm run build` não migra
// nada. Em produção, a migração é um passo explícito:
//   npm run db:deploy            (ou o workflow .github/workflows/migrate.yml)
try {
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env });
  console.log('✅ Migrações aplicadas com sucesso.');
} catch (error) {
  console.error(
    '\n🔴 `prisma migrate deploy` FALHOU — abortando (fail-closed).\n\n' +
      '   Causas comuns:\n' +
      '   1. DATABASE_URL é um pooler em transaction-mode (PgBouncer / Supabase :6543 /\n' +
      '      Neon -pooler) e não aceita DDL → configure DIRECT_URL com o endpoint :5432.\n' +
      '   2. Uma migração anterior falhou e está registrada em `_prisma_migrations`\n' +
      '      (rode `npx prisma migrate status` e resolva antes de continuar).\n' +
      '   3. A migração não é compatível com os dados atuais (ex.: ADD COLUMN NOT NULL\n' +
      '      sem default numa tabela populada).\n\n' +
      `   Detalhe: ${error?.message ?? error}\n`,
  );
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// NUNCA semear o banco a partir do build/deploy.
// ───────────────────────────────────────────────────────────────────────────
// Este script já executou `scripts/check-and-seed.ts` a cada deploy, o que
// reescrevia o `passwordHash` de contas seed (inclusive um `super_admin`
// @pontufy.com) para uma senha conhecida ('123456') — backdoor permanente em
// produção, re-armado em todo push.
//
// O bootstrap de dados agora é MANUAL e LOCAL:
//   SEED_ADMIN_PASSWORD='<senha-forte>' npx tsx scripts/check-and-seed.ts
// O script se recusa a rodar em produção e nunca sobrescreve senha existente.
// ═══════════════════════════════════════════════════════════════════════════
