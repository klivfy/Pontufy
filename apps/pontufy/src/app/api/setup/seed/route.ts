import { NextResponse } from 'next/server';
import type { Role } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/backend/db';
import { hashPassword } from '@/lib/crypto';

// ═══════════════════════════════════════════════════════════════════════════
// Bootstrap de dados — SOMENTE ambiente local de desenvolvimento.
//
// Regras de segurança (não flexibilizar):
//  1. 404 fora de desenvolvimento — nunca em produção/preview da Vercel.
//  2. Segredo PRÓPRIO (`SETUP_SECRET`), nunca `AUTH_SECRET`: o segredo de
//     assinatura de sessão não pode ser aceito como credencial de API.
//  3. Comparação em tempo constante.
//  4. `upsert` NUNCA reescreve `passwordHash` de conta existente — o endpoint
//     não é um reset de senha disfarçado.
//  5. Nada de `details: String(error)` na resposta (vazava SQL/schema).
// ═══════════════════════════════════════════════════════════════════════════

const SETUP_SECRET_MIN_LENGTH = 24;
const MIN_SEED_PASSWORD_LENGTH = 12;

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL_ENV);
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export async function POST(request: Request) {
  // Fora do ambiente local a rota simplesmente não existe.
  if (isProductionRuntime()) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const secret = process.env.SETUP_SECRET;
  if (!secret || secret.length < SETUP_SECRET_MIN_LENGTH) {
    return NextResponse.json(
      { error: `SETUP_SECRET ausente ou com menos de ${SETUP_SECRET_MIN_LENGTH} caracteres.` },
      { status: 503 },
    );
  }

  const provided = request.headers.get('x-setup-secret') ?? '';
  if (!constantTimeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
  }

  const seedPassword = process.env.SETUP_ADMIN_PASSWORD;
  if (!seedPassword || seedPassword.length < MIN_SEED_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `SETUP_ADMIN_PASSWORD ausente ou com menos de ${MIN_SEED_PASSWORD_LENGTH} caracteres.` },
      { status: 503 },
    );
  }

  try {
    const tenant = await prisma.tenant.upsert({
      where: { id: 'tenant-alpha-001' },
      update: {},
      create: {
        id: 'tenant-alpha-001',
        name: 'Empresa Alpha',
        slug: 'empresa-alpha',
        sector: 'tech',
        contractStatus: 'active',
        aiCredits: 1000,
      },
    });

    // Tenant de plataforma (obrigatório: User.tenantId é NOT NULL e o
    // super_admin precisa estar fora do domínio do tenant, ver auth.ts).
    const platformTenant = await prisma.tenant.upsert({
      where: { id: 'tenant-pontufy-platform' },
      update: {},
      create: {
        id: 'tenant-pontufy-platform',
        name: 'Pontufy',
        slug: 'pontufy-platform',
        sector: 'tech',
        contractStatus: 'active',
        plan: 'enterprise',
        aiCredits: 0,
      },
    });

    // Mesmas contas do prisma/seed.ts (auto-seed do deploy) — nunca divida os
    // dois seeds, ou o desbloqueio manual cria contas diferentes das testadas.
    // A2 — tipado com o enum: um papel inexistente passaria batido antes.
    const users: Array<{
      id: string;
      email: string;
      name: string;
      role: Role;
      points: number;
      tenantId: string;
    }> = [
      { id: 'user-admin-001', email: 'admin@empresaalpha.com', name: 'Maria Silva (RH)', role: 'admin_rh', points: 0, tenantId: tenant.id },
      { id: 'user-emp-002', email: 'joao@empresaalpha.com', name: 'João Souza', role: 'employee', points: 450, tenantId: tenant.id },
      { id: 'user-guest-001', email: 'guest@empresaalpha.com', name: 'Convidado Alpha', role: 'guest', points: 0, tenantId: tenant.id },
      { id: 'user-superadmin-001', email: 'superadmin@pontufy.com', name: 'Super Admin Pontufy', role: 'super_admin', points: 0, tenantId: platformTenant.id },
    ];

    const seededUsers: string[] = [];
    const hash = hashPassword(seedPassword);
    for (const u of users) {
      await prisma.user.upsert({
        where: { email: u.email },
        // Nunca reescrever a senha de uma conta existente.
        update: {},
        create: {
          id: u.id,
          tenantId: u.tenantId,
          name: u.name,
          email: u.email,
          role: u.role,
          pointsBalance: u.points,
          passwordHash: hash,
        },
      });
      seededUsers.push(u.email);
    }

    const courses = [
      {
        id: 'course-001',
        title: 'Liderança na Era da IA',
        description: 'Desenvolva habilidades essenciais para liderar equipes multidisciplinares com suporte de Inteligência Artificial.',
        lessons: [
          { id: 'lesson-001', title: 'O que é IA Generativa?', type: 'video', points: 50 },
          { id: 'lesson-002', title: 'Aplicações B2B da IA', type: 'video', points: 50 },
          { id: 'lesson-003', title: 'Preparando a Equipe para IA', type: 'video', points: 75 },
          { id: 'lesson-004', title: 'Gestão de Riscos com IA', type: 'video', points: 50 },
          { id: 'lesson-005', title: 'Case Studies: IA no RH', type: 'text', points: 75 },
        ],
      },
      {
        id: 'course-002',
        title: 'Comunicação Não Violenta',
        description: 'Aprenda técnicas de CNV para melhorar o ambiente corporativo e a colaboração entre equipes.',
        lessons: [
          { id: 'lesson-006', title: 'Fundamentos da CNV', type: 'video', points: 50 },
          { id: 'lesson-007', title: 'Escuta Ativa e Empatia', type: 'video', points: 50 },
          { id: 'lesson-008', title: 'Expressando Necessidades', type: 'video', points: 75 },
          { id: 'lesson-009', title: 'Resolvendo Conflitos', type: 'text', points: 75 },
        ],
      },
      {
        id: 'course-003',
        title: 'Gestão Ágil de Projetos',
        description: 'Domine frameworks ágeis como Scrum e Kanban para entregar projetos com mais velocidade e qualidade.',
        lessons: [
          { id: 'lesson-010', title: 'Manifesto Ágil', type: 'video', points: 50 },
          { id: 'lesson-011', title: 'Scrum na Prática', type: 'video', points: 75 },
          { id: 'lesson-012', title: 'Kanban para Times', type: 'video', points: 50 },
          { id: 'lesson-013', title: 'Métricas Ágeis', type: 'text', points: 75 },
        ],
      },
    ];

    for (const c of courses) {
      await prisma.course.upsert({
        where: { id: c.id },
        update: {},
        create: {
          id: c.id,
          tenantId: tenant.id,
          title: c.title,
          description: c.description,
          status: 'published',
        },
      });
      for (const l of c.lessons) {
        await prisma.lesson.upsert({
          where: { id: l.id },
          update: {},
          create: {
            id: l.id,
            courseId: c.id,
            title: l.title,
            type: l.type,
            pointsAssigned: l.points,
          },
        });
      }
    }

    const rewards = [
      { id: 'reward-001', tenantId: tenant.id, store: 'amazon', title: 'Vale-Presente Amazon R$ 50', link: 'https://amazon.com.br/vale50', price: 500, image: 'https://images.unsplash.com/photo-1523474253046-8cd2748b5fd2?auto=format&fit=crop&q=80&w=600', category: 'coupons' },
      { id: 'reward-002', tenantId: tenant.id, store: 'magalu', title: 'Cupom Magalu R$ 100', link: 'https://magazineluiza.com.br/cupom100', price: 1000, image: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&q=80&w=600', category: 'coupons' },
      { id: 'reward-003', tenantId: null, store: 'amazon', title: 'Fone de Ouvido Bluetooth Premium', link: 'https://amazon.com.br/fone-bt', price: 1200, image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&q=80&w=600', category: 'tech' },
      { id: 'reward-004', tenantId: null, store: 'shopee', title: 'Kit Exercícios Casa', link: 'https://shopee.com.br/kit-exercicio', price: 1500, image: 'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?auto=format&fit=crop&q=80&w=600', category: 'health' },
      { id: 'reward-005', tenantId: null, store: 'mercadolivre', title: 'Cadeira de Escritório Ergonômica', link: 'https://mercadolivre.com.br/cadeira-ergo', price: 3500, image: 'https://images.unsplash.com/photo-1505843490538-5133c6c7d0e1?auto=format&fit=crop&q=80&w=600', category: 'home' },
      { id: 'reward-006', tenantId: null, store: 'amazon', title: 'Smartwatch Fitness', link: 'https://amazon.com.br/smartwatch', price: 2100, image: 'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?auto=format&fit=crop&q=80&w=600', category: 'tech' },
    ];

    for (const r of rewards) {
      await prisma.reward.upsert({
        where: { id: r.id },
        update: {},
        create: {
          id: r.id,
          tenantId: r.tenantId,
          partner: r.store,
          externalId: null,
          title: r.title,
          originalUrl: r.link,
          affiliateUrl: null,
          pricePoints: r.price,
          imageUrl: r.image,
          category: r.category,
          isActive: true,
        },
      });
    }

    return NextResponse.json({
      success: true,
      tenant: tenant.name,
      users: seededUsers,
      courses: courses.length,
      rewards: rewards.length,
    });
  } catch (error) {
    console.error('POST /api/setup/seed:', error);
    return NextResponse.json({ error: 'Erro ao semear banco de dados.' }, { status: 500 });
  }
}