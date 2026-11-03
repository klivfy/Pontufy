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

try {
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env });
} catch {
  console.warn(
    '\n🟠 `prisma migrate deploy` failed during build — continuing so the deploy ' +
      'completes.\n' +
      '   If DATABASE_URL is a transaction-mode pooler (PgBouncer / Supabase :6543 / ' +
      'Neon -pooler), migrations cannot run through it. Set DIRECT_URL to the direct ' +
      '(:5432) endpoint and redeploy, or run `npm run db:migrate` against the direct URL.\n',
  );
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
