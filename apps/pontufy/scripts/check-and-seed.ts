// ═══════════════════════════════════════════════════════════════════════════
// check-and-seed.ts — bootstrap MANUAL e LOCAL do banco de desenvolvimento.
//
// ── Histórico de segurança (leia antes de mudar) ───────────────────────────
// Este script já foi executado automaticamente pelo `scripts/migrate.mjs` em
// TODO deploy. Ele fazia `user.upsert({ update: { passwordHash } })` com
// `hashPassword('123456')` em `superadmin@pontufy.com` — ou seja, um backdoor
// de super_admin com senha conhecida, re-armado a cada push, e reset silencioso
// da senha de qualquer conta seed existente.
//
// Regras que agora são PERMANENTES neste arquivo:
//   1. Nunca roda em produção nem na Vercel (`assertLocalOnly`).
//   2. Nunca sobrescreve `passwordHash` de usuário existente (upsert `update: {}`).
//   3. Senha inicial vem de `SEED_ADMIN_PASSWORD`; não existe senha default.
//
// Uso:
//   SEED_ADMIN_PASSWORD='<senha-forte>' npx tsx scripts/check-and-seed.ts
//
// A resolução de URL vive em src/infra/db.ts:
//   DATABASE_URL → POSTGRES_PRISMA_URL → POSTGRES_URL → SUPABASE_DATABASE_URL
//   → KLIV_PONT_POSTGRES_PRISMA_URL → KLIV_PONT_POSTGRES_URL
// ═══════════════════════════════════════════════════════════════════════════
import { prisma } from '../src/backend/db';
import { hashPassword, verifyPassword } from '../src/lib/crypto';

const MIN_SEED_PASSWORD_LENGTH = 12;

function assertLocalOnly(): void {
  const onVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const isProduction = process.env.NODE_ENV === 'production';

  if (onVercel || isProduction) {
    console.error(
      '🛑 check-and-seed.ts: recusando executar fora do ambiente local ' +
        `(NODE_ENV=${process.env.NODE_ENV ?? 'unset'}, VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'}).\n` +
        '   Este script existe apenas para bootstrap de desenvolvimento.',
    );
    process.exit(1);
  }
}

function resolveSeedPassword(): string {
  const value = process.env.SEED_ADMIN_PASSWORD;

  if (!value || value.length < MIN_SEED_PASSWORD_LENGTH) {
    console.error(
      `🛑 Defina SEED_ADMIN_PASSWORD com pelo menos ${MIN_SEED_PASSWORD_LENGTH} caracteres.\n` +
        "   Ex.: SEED_ADMIN_PASSWORD='dev-only-strong-password' npx tsx scripts/check-and-seed.ts\n" +
        '   (Não existe senha default: qualquer senha fixa no código é um backdoor.)',
    );
    process.exit(1);
  }

  return value;
}

async function main(): Promise<void> {
  assertLocalOnly();
  const seedPassword = resolveSeedPassword();
  const seedPasswordHash = hashPassword(seedPassword);

  console.log('--- 1. CONECTIVIDADE COM O POSTGRES ---');
  await prisma.$queryRaw`SELECT 1`;
  console.log('✅ Base de dados conectada com sucesso.');

  console.log('--- 2. TENANTS DE DESENVOLVIMENTO ---');
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'empresa-alpha' },
    update: {},
    create: {
      name: 'Empresa Alpha',
      slug: 'empresa-alpha',
      sector: 'tech',
      plan: 'trial',
      aiCredits: 50,
      primaryColor: '#10B981',
      accentColor: '#8B5CF6',
    },
  });

  // User.tenantId é NOT NULL → o super_admin de dev pertence a este tenant.
  const platformTenant = await prisma.tenant.upsert({
    where: { slug: 'pontufy-platform' },
    update: {},
    create: {
      name: 'Pontufy',
      slug: 'pontufy-platform',
      sector: 'tech',
      contractStatus: 'active',
      plan: 'enterprise',
      aiCredits: 0,
      primaryColor: '#10B981',
      accentColor: '#8B5CF6',
    },
  });

  console.log('--- 3. CONTAS DE DESENVOLVIMENTO (senha NÃO é sobrescrita) ---');

  const seeds = [
    {
      email: 'admin@empresaalpha.com',
      name: 'Gestor RH',
      role: 'admin_rh',
      tenantId: tenant.id,
      pointsBalance: 0,
    },
    {
      email: 'joao@empresaalpha.com',
      name: 'João Silva',
      role: 'employee',
      tenantId: tenant.id,
      pointsBalance: 450,
    },
    {
      email: 'superadmin@pontufy.com',
      name: 'Super Admin',
      role: 'super_admin',
      tenantId: platformTenant.id,
      pointsBalance: 0,
    },
  ] as const;

  for (const seed of seeds) {
    const existing = await prisma.user.findUnique({
      where: { email: seed.email },
      select: { id: true, passwordHash: true },
    });

    if (existing) {
      // NUNCA reescrever a senha de quem já existe — nem em desenvolvimento.
      await prisma.user.update({
        where: { id: existing.id },
        data: { name: seed.name, role: seed.role, tenantId: seed.tenantId },
      });

      const matchesSeed = existing.passwordHash
        ? verifyPassword(seedPassword, existing.passwordHash)
        : false;
      console.log(
        matchesSeed
          ? `   ${seed.email}: conta existente, senha confere com SEED_ADMIN_PASSWORD ✅`
          : `   ${seed.email}: conta existente, senha DIFERENTE de SEED_ADMIN_PASSWORD (mantida) ⚠️`,
      );
      continue;
    }

    await prisma.user.create({
      data: {
        email: seed.email,
        name: seed.name,
        role: seed.role,
        tenantId: seed.tenantId,
        pointsBalance: seed.pointsBalance,
        passwordHash: seedPasswordHash,
      },
    });
    console.log(`   ${seed.email}: conta criada com SEED_ADMIN_PASSWORD ✅`);
  }

  console.log('\n✅ Bootstrap de desenvolvimento concluído.');
  console.log('   Login local: use SEED_ADMIN_PASSWORD para as contas acima.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
