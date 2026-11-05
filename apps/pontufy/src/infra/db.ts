import { PrismaClient } from '@prisma/client';

// PostgreSQL is the only production-viable engine: Vercel serverless gives each
// instance an ephemeral filesystem, so SQLite loses every write on cold start.
// The pooled Postgres endpoint must be resolvable through any of the variables
// Vercel may inject (Supabase integration exposes its own names) — resolved with
// automatic fallbacks below. DIRECT_URL (used by `prisma migrate`) points at the
// direct, unpooled endpoint.
// Canonical names first so local `.env.local` keeps winning. Then unprefixed
// Vercel/Supabase names, then the Marketplace prefix (KLIV_PONT_*).
const POOLED_URL_KEYS = [
  'DATABASE_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'SUPABASE_DATABASE_URL',
  'KLIV_PONT_POSTGRES_PRISMA_URL',
  'KLIV_PONT_POSTGRES_URL',
] as const;

const DIRECT_URL_KEYS = [
  'DIRECT_URL',
  'POSTGRES_URL_NON_POOLING',
  'SUPABASE_DIRECT_URL',
  'KLIV_PONT_POSTGRES_URL_NON_POOLING',
] as const;

function firstDefinedEnv(keys: readonly string[]): { value?: string; source?: string } {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return { value, source: key };
  }
  return {};
}

const pooled = firstDefinedEnv(POOLED_URL_KEYS);
const direct = firstDefinedEnv(DIRECT_URL_KEYS);

export const databaseUrl = pooled.value;
export const directUrl = direct.value;

if (!databaseUrl) {
  console.error(
    '🔴 No PostgreSQL connection string is set. Configure one of: ' +
      POOLED_URL_KEYS.join(', ') +
      ' (pooled endpoint) before starting the app.',
  );
} else {
  // Log only the variable NAME that resolved — never the value (secret).
  console.log(
    `🔌 db.ts: conexão pooled <- \`${pooled.source}\` | direct <- \`${direct.source ?? 'unset'}\``,
  );
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Operation classification shared across model branches.
const READ_OPS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
];
const WRITE_OPS = ['update', 'updateMany', 'delete', 'deleteMany'];
// Relation filters (e.g. `course: { is: {...} }`) are rejected by Prisma inside
// a findUnique `where`, so reads that must be relation-scoped use findFirst.
const RELATION_SAFE_READ_OPS = ['findFirst', 'findFirstOrThrow', 'findMany', 'count'];

// Models that are strictly tenant-scoped (every row belongs to exactly one tenant)
const STRICT_TENANT_MODELS = [
  'User',
  'Course',
  'PointsLedger',
  'AuditLog',
  'Invitation',
  'PasswordReset',
  'LessonCompletion',
  'QuizAttempt',
  'Commission',
  'StripeEvent',
  'IssuedCertificate',
  'Notification',
  'Skill',
  'SkillNode',
  'UserSkillProgress',
  'Battle',
  'Redemption',
  // Modelos criados depois do interceptor: sem entrada aqui, getTenantDb
  // NÃO escopa a query. Descoberto ao ler flag do tenant beta e receber a do
  // alpha (C4). Regra: todo modelo com coluna tenantId entra nesta lista.
  'FeatureFlag',
  'PointsLot',
  'UploadQuota',
  'EmailVerification',
  'OutboxEvent',
  'LessonStart',
] as const;

/**
 * Zero Trust Prisma extension — isolates every query to the caller's tenant.
 *
 * Per-model scoping:
 *  - Tenant: global lookup by design (callers always pass the session tenantId).
 *  - STRICT_TENANT_MODELS: strict `tenantId` equality injected into every read and write.
 *  - Reward: reads expose global (tenantId = null) + own tenant; writes are
 *    restricted to the caller's own rewards (global/foreign rewards are immutable).
 *  - Lesson: no tenantId column — reads are scoped through the parent Course
 *    relation (`course.tenantId`). findUnique cannot carry a relation filter, so
 *    tenant-sensitive lookups must use findFirst (enforced at call sites).
 *  - LessonCompletion: scoped by tenantId (injected automatically by this extension).
 *    Use findFirst (not findUnique) for tenant-sensitive lookups — findUnique rejects
 *    extra where fields injected by the interceptor.
 *  - All other models (Tenant): no tenant isolation applied.
 */
export function getTenantDb(tenantId: string) {
  if (!tenantId) throw new Error('Operação negada: tenantId não fornecido.');

  /**
   * Filtro de tenant para o `where` do chamador.
   *
   * `findUnique`/`findUniqueOrThrow` aceitam campos não-únicos (Prisma ≥ 4.5,
   * "extendedWhereUnique"), mas NÃO aceitam `AND` — a query estoura e a rota
   * devolve erro genérico. Por isso esses dois operadores recebem espalhamento
   * e todo o resto recebe `AND`, que preserva um filtro explícito do chamador
   * em vez de sobrescrevê-lo.
   */
  const UNIQUE_OPS = ['findUnique', 'findUniqueOrThrow'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withTenant = (where: any, operation: string) =>
    UNIQUE_OPS.includes(operation)
      ? { ...(where ?? {}), tenantId }
      : { AND: [where ?? {}, { tenantId }] };

  /**
   * upsert exige um "where" de chave unica. Injetar AND quebra a query
   * (PrismaClientValidationError); espalhar funciona, EXCETO quando a chave ja
   * e composta e contem tenantId — ai qualquer campo extra vira argumento
   * desconhecido.
   *
   * Regra: se o "where" ja referencia tenantId, deixamos como esta (a chave
   * esta escopada); senao espalhamos tenantId, para impedir sequestrar
   * registro de outro tenant por chave unica global (ex.: upsert por e-mail).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withUpsertWhere = (where: any) =>
    JSON.stringify(where ?? {}).includes('tenantId') ? where : { ...(where ?? {}), tenantId };

  return prisma.$extends({
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const scope = (nextArgs: any) => Object.assign(args, nextArgs);

          // Tenant: global lookup (no scoping)
          if (model === 'Tenant') {
            return query(args);
          }

          // Reward: hybrid model — global (tenantId: null) visible to all,
          // own rewards read/write. Global rewards are immutable.
          if (model === 'Reward') {
            if (READ_OPS.includes(operation)) {
              // `AND` em vez de espalhar `OR` no topo: o filtro do chamador era
              // SOBRESCRITO quando ele já usava `OR`, mudando a semântica da
              // query em silêncio.
              scope({ where: { AND: [args.where ?? {}, { OR: [{ tenantId: null }, { tenantId }] }] } });
            } else if (WRITE_OPS.includes(operation)) {
              scope({ where: withTenant(args.where, operation) });
            } else if (operation === 'upsert') {
              // `upsert` não estava em nenhuma lista: passava direto, sem
              // tenantId no where nem no create (buraco do "Zero Trust").
              scope({
                where: withUpsertWhere(args.where),
                create: { ...(args.create ?? {}), tenantId },
              });
            } else if (['create', 'createMany'].includes(operation)) {
              // Escrita de Reward pelo client de tenant é sempre do PRÓPRIO
              // tenant. Recompensa global só é criada por job de plataforma
              // (getRawPrisma).
              const currentData = args.data;
              if (Array.isArray(currentData)) {
                currentData.forEach((d: Record<string, unknown>) => {
                  d.tenantId = tenantId;
                });
              } else if (currentData) {
                currentData.tenantId = tenantId;
              }
            }
            return query(args);
          }

          // Lesson: scope through the parent Course relation.
          // Relation filters are invalid inside findUnique, so only relation-safe reads get scoped.
          if (model === 'Lesson') {
            if (RELATION_SAFE_READ_OPS.includes(operation)) {
              scope({ where: { ...(args.where ?? {}), course: { is: { tenantId } } } });
            }
            // For writes (create/update/delete), tenant scoping is enforced at the Course level
            // via the relation. The interceptor does not inject tenantId on Lesson writes
            // because Lesson has no tenantId column.
            return query(args);
          }

          // Strict tenant isolation for all tenant-owned models.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (STRICT_TENANT_MODELS.includes(model as any)) {
            if ([...READ_OPS, ...WRITE_OPS].includes(operation)) {
              scope({ where: withTenant(args.where, operation) });
            } else if (operation === 'upsert') {
              scope({
                where: withUpsertWhere(args.where),
                create: { ...(args.create ?? {}), tenantId },
              });
            } else if (['create', 'createMany'].includes(operation)) {
              const currentData = args.data;
              if (Array.isArray(currentData)) {
                currentData.forEach((d: Record<string, unknown>) => (d.tenantId = tenantId));
              } else {
                currentData.tenantId = tenantId;
              }
            }
          }

          return query(args);
        },
      },
    },
  });
}

// O client sem escopo de tenant NÃO mora mais aqui: ver `src/infra/platform-db.ts`.
// Manter `getRawPrisma` no mesmo módulo de `getTenantDb` tornava o atalho
// invisível — importar do nome hostil é uma decisão deliberada.

