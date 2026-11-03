import { spawnSync } from 'child_process';
import path from 'path';
import { randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';
import { PrismaClient } from '@prisma/client';
import { FIXTURES, USERS } from './helpers/db';

const scryptAsync = promisify(scrypt);

const APP_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(__dirname, '../..');
const NODE = process.execPath;
const PRISMA_CLI = path.join(ROOT_DIR, 'node_modules', 'prisma', 'build', 'index.js');
const TSX_CLI = path.join(ROOT_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SEED_FILE = path.join(APP_DIR, 'prisma', 'seed.ts');
const SCHEMA_FILE = path.join(APP_DIR, 'prisma', 'schema.prisma');

function run(cmd: string, args: string[], cwd: string, label: string): void {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env, shell: false });
  if (res.status !== 0) {
    throw new Error(`[global-setup] ${label} falhou (exit ${res.status}). ${res.stderr?.toString() ?? ''}`);
  }
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString('hex')}`;
}

export default async function globalSetup(): Promise<void> {
  // ── 1. Validação de ambiente (fail fast com instruções) ─────────────────
  if (!process.env.DATABASE_URL) {
    throw new Error(
      '[global-setup] DATABASE_URL não definida. Exporte as variáveis do ambiente ' +
        'antes de rodar os testes (veja apps/pontufy/.env.example).',
    );
  }

  // ── 1.1 Trava de segurança (V8) ─────────────────────────────────────────
  // Este setup APAGA ledger, conclusões, certificados e reseta saldos de
  // usuários reais (ver seção 5). Se DATABASE_URL apontar para um banco
  // remoto por engano — inclusive produção — o estrago é irreversível.
  const databaseHost = (() => {
    try {
      return new URL(process.env.DATABASE_URL as string).hostname;
    } catch {
      return '';
    }
  })();
  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres']);
  const isLocalDatabase = LOCAL_HOSTS.has(databaseHost);

  if (!isLocalDatabase && process.env.ALLOW_DESTRUCTIVE_TESTS !== '1') {
    throw new Error(
      `[global-setup] DATABASE_URL aponta para "${databaseHost}", que não é local.\n` +
        'A suíte APAGA lançamentos do ledger, conclusões de aula, tentativas de quiz e\n' +
        'certificados de usuários reais. Se este banco é descartável e você aceita o\n' +
        'risco, rode com ALLOW_DESTRUCTIVE_TESTS=1.',
    );
  }

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn(
      '[global-setup] ⚠ Redis (UPSTASH_REDIS_REST_URL/TOKEN) não configurado. ' +
        'Conclusão de aulas retornará 429 (lock fail-closed) e os testes de ' +
        'concorrência serão pulados.',
    );
  }

  // ── 2. Migrations pendentes + seed idempotente ──────────────────────────
  run(NODE, [PRISMA_CLI, 'migrate', 'deploy', '--schema', SCHEMA_FILE], APP_DIR, 'migrate deploy');
  run(NODE, [TSX_CLI, SEED_FILE], APP_DIR, 'seed');

  // ── 3. Fixtures dedicados de teste + reset de estado E2E ────────────────
  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword('123456');

    const beta = await prisma.tenant.upsert({
      where: { slug: FIXTURES.tenantBetaSlug },
      update: {
        name: 'Beta Corp',
        sector: 'retail',
        contractStatus: 'active',
        plan: 'starter',
        aiCredits: 10,
        primaryColor: '#3B82F6',
        accentColor: '#F59E0B',
      },
      create: {
        id: 'tenant-beta-001',
        name: 'Beta Corp',
        slug: FIXTURES.tenantBetaSlug,
        sector: 'retail',
        contractStatus: 'active',
        plan: 'starter',
        aiCredits: 10,
        primaryColor: '#3B82F6',
        accentColor: '#F59E0B',
      },
    });

    const betaUsers = [
      { id: 'user-beta-admin', email: USERS.betaAdmin, name: 'Admin Beta', role: 'admin_rh', pointsBalance: 0 },
      { id: 'user-beta-emp', email: USERS.betaEmployee, name: 'Funcionário Beta', role: 'employee', pointsBalance: 300 },
    ];
    for (const u of betaUsers) {
      await prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, role: u.role, tenantId: beta.id, pointsBalance: u.pointsBalance, passwordHash },
        create: { ...u, tenantId: beta.id, passwordHash },
      });
    }

    const alphaExtras = [
      { id: 'user-alpha-vip', email: USERS.alphaVip, name: 'Vip Alpha', role: 'employee' as const, pointsBalance: 2000 },
      { id: 'user-alpha-poor', email: USERS.alphaPoor, name: 'Pobre Alpha', role: 'employee' as const, pointsBalance: 100 },
      { id: 'user-alpha-race', email: USERS.race, name: 'Corrida Alpha', role: 'employee' as const, pointsBalance: 0 },
    ];
    for (const u of alphaExtras) {
      const tenantId = await prisma.tenant
        .findUnique({ where: { slug: 'empresa-alpha' }, select: { id: true } })
        .then((t) => t?.id);
      if (!tenantId) throw new Error('Tenant empresa-alpha ausente após seed.');
      await prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, role: u.role, tenantId, pointsBalance: u.pointsBalance, passwordHash },
        create: { ...u, tenantId, passwordHash },
      });
    }

    // Cursos de isolamento multi-tenant (IDs fixos, um por tenant).
    await prisma.course.upsert({
      where: { id: FIXTURES.courseIsolationAlpha },
      update: { tenantId: 'tenant-alpha-001', title: 'Projeto Confidencial Alpha', status: 'published', workloadHours: 1 },
      create: {
        id: FIXTURES.courseIsolationAlpha,
        tenantId: 'tenant-alpha-001',
        title: 'Projeto Confidencial Alpha',
        description: 'Conteúdo exclusivo da Empresa Alpha — nunca visível ao Tenant B.',
        status: 'published',
        workloadHours: 1,
      },
    });
    await prisma.lesson.upsert({
      where: { id: FIXTURES.lessonIsolationAlpha },
      update: { courseId: FIXTURES.courseIsolationAlpha, title: 'Aula Confidencial Alpha', type: 'text', pointsAssigned: 15 },
      create: {
        id: FIXTURES.lessonIsolationAlpha,
        courseId: FIXTURES.courseIsolationAlpha,
        title: 'Aula Confidencial Alpha',
        type: 'text',
        contentUrl: '## Conteúdo interno Alpha',
        pointsAssigned: 15,
      },
    });
    await prisma.course.upsert({
      where: { id: FIXTURES.courseIsolationBeta },
      update: { tenantId: beta.id, title: 'Projeto Secreto Beta', status: 'published', workloadHours: 1 },
      create: {
        id: FIXTURES.courseIsolationBeta,
        tenantId: beta.id,
        title: 'Projeto Secreto Beta',
        description: 'Conteúdo exclusivo da Beta Corp.',
        status: 'published',
        workloadHours: 1,
      },
    });
    await prisma.lesson.upsert({
      where: { id: FIXTURES.lessonIsolationBeta },
      update: { courseId: FIXTURES.courseIsolationBeta, title: 'Aula Secreta Beta', type: 'text', pointsAssigned: 15 },
      create: {
        id: FIXTURES.lessonIsolationBeta,
        courseId: FIXTURES.courseIsolationBeta,
        title: 'Aula Secreta Beta',
        type: 'text',
        contentUrl: '## Conteúdo interno Beta',
        pointsAssigned: 15,
      },
    });

    // ── Reset determinístico do estado E2E (seed é idempotente, não reset) ──
    const resets: { email: string; balance: number }[] = [
      { email: USERS.alphaEmployee, balance: 450 }, // jornada completa do colaborador
      { email: USERS.alphaVip, balance: 2000 }, // resgate com saldo suficiente
      { email: USERS.alphaPoor, balance: 100 }, // resgate sem saldo
      { email: USERS.race, balance: 0 }, // corrida de concorrência
      { email: USERS.betaEmployee, balance: 300 },
    ];
    for (const r of resets) {
      const user = await prisma.user.findUnique({ where: { email: r.email }, select: { id: true } });
      if (!user) continue;
      await prisma.pointsLedger.deleteMany({ where: { userId: user.id } });
      await prisma.lessonCompletion.deleteMany({ where: { userId: user.id } });
      await prisma.quizAttempt.deleteMany({ where: { userId: user.id } });
      await prisma.issuedCertificate.deleteMany({ where: { userId: user.id } });
      await prisma.user.update({ where: { id: user.id }, data: { pointsBalance: r.balance } });
    }

    console.log('[global-setup] fixtures prontos: Beta Corp, usuários dedicados e reset E2E aplicados.');
  } finally {
    await prisma.$disconnect();
  }
}