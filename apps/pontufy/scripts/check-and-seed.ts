// ═══════════════════════════════════════════════════════════════════════════
// check-and-seed.ts — sincronização e povoamento idempotente do banco.
// Rodado pelo migrate.mjs em cada deploy (Vercel) ou manualmente:
//   npx tsx scripts/check-and-seed.ts
//
// 1. CONECTIVIDADE: valida a ligação ao PostgreSQL (Supabase). A resolução
//    de URL vive em src/infra/db.ts (e migrate.mjs remapeia para o Prisma CLI):
//    DATABASE_URL → POSTGRES_PRISMA_URL → POSTGRES_URL → SUPABASE_DATABASE_URL
//    → KLIV_PONT_POSTGRES_PRISMA_URL → KLIV_PONT_POSTGRES_URL
//    DIRECT_URL → POSTGRES_URL_NON_POOLING → SUPABASE_DIRECT_URL
//    → KLIV_PONT_POSTGRES_URL_NON_POOLING
// 2. POVOAMENTO: upserts idempotentes do tenant de homologação + utilizadores
//    de teste (credenciais determinísticas: senha 123456, scrypt canónico).
// 3. VALIDAÇÃO: verifica cada hash com verifyPassword (timingSafeEqual).
//
// Adaptações ao schema Pontufy (vs. prompt mestre):
//  - User.passwordHash (não `password`).
//  - User.tenantId é NOT NULL → super_admin vive no tenant de plataforma
//    "pontufy-platform" (não `null`).
//  - Tenant.sector é obrigatório no schema.
// ═══════════════════════════════════════════════════════════════════════════
import { prisma } from '../src/backend/db';
import { hashPassword, verifyPassword } from '../src/lib/crypto';

async function main() {
  console.log('--- 1. CONECTIVIDADE COM SUPABASE ---');
  await prisma.$queryRaw`SELECT 1`;
  console.log('✅ Base de dados PostgreSQL conectada com sucesso.');

  console.log('--- 2. POVOAMENTO DE LOCATÁRIO & UTILIZADORES ---');
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

  // User.tenantId é NOT NULL → o super_admin pertence ao tenant de plataforma.
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

  const passwordHash = hashPassword('123456');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@empresaalpha.com' },
    update: { passwordHash, tenantId: tenant.id },
    create: {
      email: 'admin@empresaalpha.com',
      name: 'Gestor RH',
      role: 'admin_rh',
      passwordHash,
      tenantId: tenant.id,
    },
  });

  const employee = await prisma.user.upsert({
    where: { email: 'joao@empresaalpha.com' },
    update: { passwordHash, tenantId: tenant.id },
    create: {
      email: 'joao@empresaalpha.com',
      name: 'João Silva',
      role: 'employee',
      passwordHash,
      pointsBalance: 450,
      tenantId: tenant.id,
    },
  });

  const superadmin = await prisma.user.upsert({
    where: { email: 'superadmin@pontufy.com' },
    update: { passwordHash, tenantId: platformTenant.id },
    create: {
      email: 'superadmin@pontufy.com',
      name: 'Super Admin',
      role: 'super_admin',
      passwordHash,
      tenantId: platformTenant.id,
    },
  });

  console.log('--- 3. TESTE DE VALIDAÇÃO DE PALAVRAS-PASSE ---');
  const test1 = verifyPassword('123456', admin.passwordHash!);
  const test2 = verifyPassword('123456', employee.passwordHash!);
  const test3 = verifyPassword('123456', superadmin.passwordHash!);

  console.log(`admin@empresaalpha.com: ${test1 ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`joao@empresaalpha.com: ${test2 ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`superadmin@pontufy.com: ${test3 ? 'PASSED ✅' : 'FAILED ❌'}`);

  if (!test1 || !test2 || !test3) {
    throw new Error('Falha crítica na validação da cifra de palavra-passe.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });