import { PrismaClient } from '@prisma/client';
import type { Role } from '@prisma/client';
import { hashPassword } from '../src/lib/crypto';

// ═══════════════════════════════════════════════════════════════════════════
// Seed idempotente de homologação — Pontufy
// ───────────────────────────────────────────────────────────────────────────
// - 100% idempotente: upserts por chaves únicas (email, slug, ids fixos).
// - Senhas no padrão Pontufy: scrypt(salt, 64 bytes) → "salt:hash" (hex 64),
//   geradas pelo módulo canónico src/lib/crypto.ts (o mesmo usado por
//   src/auth.ts / verifyPassword em produção).
// - Zero Trust: todo usuário criado tem tenantId explícito; o único usuário
//   fora do domínio do tenant é o super_admin (@pontufy.com), alocado no
//   tenant de plataforma "Pontufy" (User.tenantId é NOT NULL no schema).
// ═══════════════════════════════════════════════════════════════════════════

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = '123456';

// ── Tenant de plataforma (super_admin) ────────────────────────────────────────
const PLATFORM_TENANT = {
  id: 'tenant-pontufy-platform',
  name: 'Pontufy',
  slug: 'pontufy-platform',
  sector: 'tech',
  contractStatus: 'active',
  plan: 'enterprise',
  aiCredits: 0,
  primaryColor: '#495453',
  accentColor: '#A7E3C1',
} as const;

// ── Tenant principal de homologação ───────────────────────────────────────────
const ALPHA_TENANT = {
  id: 'tenant-alpha-001',
  name: 'Empresa Alpha',
  slug: 'empresa-alpha',
  sector: 'tech',
  contractStatus: 'active',
  plan: 'starter',
  aiCredits: 50,
  primaryColor: '#495453',
  accentColor: '#A7E3C1',
} as const;

async function main() {
  console.log('── Iniciando seed (idempotente) ──');

  // 1. Tenants (upsert por slug)
  const alpha = await prisma.tenant.upsert({
    where: { slug: ALPHA_TENANT.slug },
    update: {
      name: ALPHA_TENANT.name,
      sector: ALPHA_TENANT.sector,
      contractStatus: ALPHA_TENANT.contractStatus,
      plan: ALPHA_TENANT.plan,
      aiCredits: ALPHA_TENANT.aiCredits,
      primaryColor: ALPHA_TENANT.primaryColor,
      accentColor: ALPHA_TENANT.accentColor,
    },
    create: { ...ALPHA_TENANT },
  });
  console.log(`Tenant: ${alpha.name} (${alpha.slug}) — aiCredits ${alpha.aiCredits}`);

  const platform = await prisma.tenant.upsert({
    where: { slug: PLATFORM_TENANT.slug },
    update: {
      name: PLATFORM_TENANT.name,
      sector: PLATFORM_TENANT.sector,
      contractStatus: PLATFORM_TENANT.contractStatus,
      plan: PLATFORM_TENANT.plan,
      aiCredits: PLATFORM_TENANT.aiCredits,
      primaryColor: PLATFORM_TENANT.primaryColor,
      accentColor: PLATFORM_TENANT.accentColor,
    },
    create: { ...PLATFORM_TENANT },
  });
  console.log(`Tenant: ${platform.name} (${platform.slug}) — domínio super_admin`);

  // 2. Utilizadores de teste (upsert por email; senha padrão 123456)
  const passwordHash = hashPassword(DEFAULT_PASSWORD);
  const users: Array<{ id: string; tenantId: string; email: string; name: string; role: Role; pointsBalance: number }> = [
    {
      id: 'user-admin-001',
      tenantId: alpha.id,
      email: 'admin@empresaalpha.com',
      name: 'Maria Silva (RH)',
      role: 'admin_rh',
      pointsBalance: 0,
    },
    {
      id: 'user-emp-002',
      tenantId: alpha.id,
      email: 'joao@empresaalpha.com',
      name: 'João Souza',
      role: 'employee',
      pointsBalance: 450,
    },
    {
      id: 'user-guest-001',
      tenantId: alpha.id,
      email: 'guest@empresaalpha.com',
      name: 'Convidado Alpha',
      role: 'guest',
      pointsBalance: 0,
    },
    {
      id: 'user-superadmin-001',
      tenantId: platform.id,
      email: 'superadmin@pontufy.com',
      name: 'Super Admin Pontufy',
      role: 'super_admin',
      pointsBalance: 0,
    },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        tenantId: u.tenantId,
        pointsBalance: u.pointsBalance,
        passwordHash,
      },
      create: { ...u, passwordHash },
    });
    console.log(`User: ${u.email} (${u.role})`);
  }

  // 3. Curso inicial + 3 lições completas em Markdown + quiz de 3 perguntas
  //
  // O quiz vai como ARRAY, não como string. `Course.quizJson` é `Json` no
  // Prisma: `JSON.stringify(...)` gravava um jsonb do tipo `string`, e o leitor
  // (`parseQuizModules`) devolvia [] — o curso de demonstração simplesmente não
  // tinha quiz. Pior: `submitQuiz` respondia 500 ao validar a string como array
  // de módulos. Descoberto pelo teste do quiz dinâmico no CI, que não encontrava
  // nenhum curso publicado com questões.
  const LGPD_QUIZ = [
    {
      module: 'Segurança da Informação e LGPD',
      questions: [
        {
          question:
            'Qual princípio da LGPD limita o tratamento de dados ao mínimo necessário para a finalidade declarada?',
          options: [
            { text: 'Necessidade' },
            { text: 'Transparência' },
            { text: 'Segurança' },
            { text: 'Livre acesso' },
          ],
          correctIndex: 0,
        },
        {
          question: 'O que é phishing?',
          options: [
            { text: 'Um tipo de firewall corporativo' },
            {
              text: 'Uma técnica de engenharia social para obter dados confidenciais',
            },
            { text: 'Um backup automatizado em nuvem' },
            { text: 'Uma política de senhas fortes' },
          ],
          correctIndex: 1,
        },
        {
          question:
            'Ao receber um e-mail de um suposto fornecedor pedindo suas credenciais de acesso, o correto é:',
          options: [
            { text: 'Clicar no link e verificar o sistema' },
            { text: 'Responder solicitando mais informações' },
            { text: 'Encaminhar para os colegas' },
            {
              text: 'Verificar a legitimidade pelo canal oficial antes de qualquer resposta',
            },
          ],
          correctIndex: 3,
        },
      ],
    },
  ];

  const lgpdCourse = await prisma.course.upsert({
    where: { id: 'course-lgpd-001' },
    update: {
      title: 'Segurança da Informação e LGPD no Trabalho Remoto',
      description:
        'Aprenda os fundamentos de segurança da informação e a Lei Geral de Proteção de Dados (LGPD) aplicados ao trabalho remoto, com boas práticas para proteger dados pessoais e corporativos.',
      status: 'published',
      quizJson: LGPD_QUIZ,
      workloadHours: 8,
    },
    create: {
      id: 'course-lgpd-001',
      tenantId: alpha.id,
      title: 'Segurança da Informação e LGPD no Trabalho Remoto',
      description:
        'Aprenda os fundamentos de segurança da informação e a Lei Geral de Proteção de Dados (LGPD) aplicados ao trabalho remoto, com boas práticas para proteger dados pessoais e corporativos.',
      status: 'published',
      quizJson: LGPD_QUIZ,
      workloadHours: 8,
    },
  });

  const lgpdLessons = [
    {
      id: 'lesson-lgpd-001',
      courseId: lgpdCourse.id,
      title: 'Fundamentos de Segurança da Informação',
      type: 'text',
      pointsAssigned: 40,
      contentUrl: `## O que é Segurança da Informação?

Segurança da informação é o conjunto de práticas que protege a **confidencialidade**, a **integridade** e a **disponibilidade** dos dados — a tríade CID.

### Os três pilares

- **Confidencialidade**: somente pessoas autorizadas acessam os dados.
- **Integridade**: os dados não são alterados de forma não autorizada.
- **Disponibilidade**: os dados estão acessíveis quando necessários.

### Ameaças comuns

1. Engenharia social (phishing, pretexting).
2. Malware e ransomware.
3. Acesso não autorizado por senhas fracas.

## Por que isso importa no trabalho remoto?

No home office, os dados corporativos trafegam por redes domésticas e dispositivos pessoais. Cada colaborador é a **primeira linha de defesa**: a falha de um único usuário pode comprometer toda a empresa.

> **Regra de ouro:** desconfie de tudo que parecer urgente demais ou bom demais para ser verdade.`,
    },
    {
      id: 'lesson-lgpd-002',
      courseId: lgpdCourse.id,
      title: 'LGPD: Princípios e Direitos do Titular',
      type: 'text',
      pointsAssigned: 40,
      contentUrl: `## O que é a LGPD?

A Lei Geral de Proteção de Dados (Lei nº 13.709/2018) regula o tratamento de dados pessoais no Brasil, inclusive no ambiente digital.

### Princípios que guiam o tratamento

- **Finalidade**: tratar apenas para propósitos legítimos e informados.
- **Necessidade**: limitar o tratamento ao mínimo necessário.
- **Transparência**: informar claramente como os dados são usados.
- **Segurança**: adotar medidas técnicas e administrativas de proteção.

### Direitos do titular

O titular (o colaborador) tem direito a:

1. Confirmação e acesso aos dados tratados.
2. Correção de dados incompletos ou desatualizados.
3. Portabilidade e eliminação, quando aplicável.
4. Informação sobre compartilhamento com terceiros.

### Na prática, no dia a dia

- Nunca colete dados que a empresa não precisa.
- Não compartilhe dados pessoais de colegas ou clientes fora dos canais oficiais.
- Reporte vazamentos ou suspeitas ao canal de privacidade da empresa.`,
    },
    {
      id: 'lesson-lgpd-003',
      courseId: lgpdCourse.id,
      title: 'Trabalho Remoto: Boas Práticas e Incidentes',
      type: 'text',
      pointsAssigned: 50,
      contentUrl: `## Boas práticas no trabalho remoto

### Senhas e autenticação

- Use senhas fortes e **únicas** por serviço.
- Ative a **autenticação multifator (MFA)** sempre que disponível.
- Nunca compartilhe credenciais por mensagem.

### Dispositivos e redes

- Mantenha o sistema operacional e os aplicativos atualizados.
- Prefira redes Wi-Fi protegidas; evite redes públicas abertas.
- Utilize o **VPN corporativo** para acessar sistemas internos.

### E-mails e links

- Verifique o remetente antes de clicar em qualquer link ou anexo.
- Desconfie de mensagens com tom de urgência pedindo dados ou pagamentos.
- Ao menor sinal de phishing, **não responda** — reporte ao suporte.

## O que fazer em caso de incidente?

1. **Não altere nada**: não apague e-mails, logs ou arquivos envolvidos.
2. **Comunique imediatamente** o time de segurança/TI.
3. **Mude a senha** do serviço afetado e revogue sessões ativas.
4. Documente o ocorrido: horário, mensagens, links clicados.

> Lembre-se: reportar rápido não é punição — é proteção coletiva.`,
    },
  ];

  for (const lesson of lgpdLessons) {
    await prisma.lesson.upsert({
      where: { id: lesson.id },
      update: {
        title: lesson.title,
        type: lesson.type,
        contentUrl: lesson.contentUrl,
        pointsAssigned: lesson.pointsAssigned,
      },
      create: lesson,
    });
  }
  console.log(`Course: ${lgpdCourse.title} (${lgpdLessons.length} lessons + quiz)`);

  // 4. Catálogo de recompensas do tenant Empresa Alpha
  const rewards = [
    {
      id: 'reward-001',
      tenantId: alpha.id,
      partner: 'custom',
      externalId: null,
      title: 'Cartão Presente Amazon R$ 50',
      originalUrl: 'https://www.amazon.com.br/giftcard',
      affiliateUrl: null,
      pricePoints: 500,
      imageUrl: 'https://images.unsplash.com/photo-1523474253046-8cd2748b5fd2?auto=format&fit=crop&q=80&w=600',
      category: 'coupons',
      isActive: true,
    },
    {
      id: 'reward-002',
      tenantId: alpha.id,
      partner: 'custom',
      externalId: null,
      title: 'Voucher iFood R$ 30',
      originalUrl: 'https://www.ifood.com.br',
      affiliateUrl: null,
      pricePoints: 300,
      imageUrl: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&q=80&w=600',
      category: 'coupons',
      isActive: true,
    },
    {
      id: 'reward-003',
      tenantId: alpha.id,
      partner: 'custom',
      externalId: null,
      title: 'Curso Avançado de Liderança',
      originalUrl: 'https://www.pontufy.com/lideranca-avancada',
      affiliateUrl: null,
      pricePoints: 1000,
      imageUrl: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&q=80&w=600',
      category: 'courses',
      isActive: true,
    },
  ];

  for (const reward of rewards) {
    await prisma.reward.upsert({
      where: { id: reward.id },
      update: {
        tenantId: reward.tenantId,
        partner: reward.partner,
        externalId: reward.externalId,
        title: reward.title,
        originalUrl: reward.originalUrl,
        affiliateUrl: reward.affiliateUrl,
        pricePoints: reward.pricePoints,
        imageUrl: reward.imageUrl,
        category: reward.category,
        isActive: reward.isActive,
      },
      create: { ...reward },
    });
  }
  console.log(`Rewards: ${rewards.length} recompensas ativas`);

  // 5. Resumo
  const summary = {
    tenants: await prisma.tenant.count(),
    users: await prisma.user.count(),
    courses: await prisma.course.count(),
    lessons: await prisma.lesson.count(),
    rewards: await prisma.reward.count(),
  };
  console.log('── Resumo do seed ──');
  console.log(JSON.stringify(summary, null, 2));
  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });