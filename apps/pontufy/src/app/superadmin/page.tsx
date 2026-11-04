import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Building2, ShieldAlert, CreditCard, Server } from 'lucide-react';
import { requireSuperAdmin } from '@/domain/auth';
import { getRawPrisma } from '@/infra/platform-db';
import { getRedis } from '@/infra/redis';

export default async function SuperAdminPage() {
  // V5 — papel e versão de sessão relidos do banco (não do token).
  let ctx: Awaited<ReturnType<typeof requireSuperAdmin>>;
  try {
    ctx = await requireSuperAdmin();
  } catch {
    redirect('/superadmin/login');
  }

  const prisma = getRawPrisma();
  const [tenantCount, creditSum, blockedIps] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.aggregate({ _sum: { aiCredits: true } }),
    countBlockedIps(),
  ]);

  const cards = [
    {
      href: '/superadmin/tenants',
      icon: <Building2 size={22} />,
      title: 'Locatários & Consumo de IA',
      description: 'Governança global de tenants, créditos e planos.',
      badge: `${tenantCount} tenant${tenantCount === 1 ? '' : 's'}`,
      badgeColor: 'bg-md-tertiary-container text-md-on-tertiary-container',
    },
    {
      href: '/superadmin/security',
      icon: <ShieldAlert size={22} />,
      title: 'IPs Bloqueados',
      description: 'Monitoramento de força bruta e abuso.',
      badge: `${blockedIps} IP${blockedIps === 1 ? '' : 's'}`,
      badgeColor: 'bg-md-error/10 text-md-error',
    },
    {
      href: '/superadmin/tenants',
      icon: <CreditCard size={22} />,
      title: 'Créditos de IA',
      description: 'Gerenciar e distribuir créditos de geração por tenant.',
      badge: String(creditSum._sum.aiCredits ?? 0),
      badgeColor: 'bg-md-primary-container text-md-on-primary-container',
    },
    {
      href: '/superadmin/tenants',
      icon: <Server size={22} />,
      title: 'Infraestrutura',
      description: 'Tenants ativos no PostgreSQL compartilhado.',
      badge: 'Ativo',
      badgeColor: 'bg-md-tertiary-container text-md-on-tertiary-container',
    },
  ];

  return (
    <main className="min-h-screen bg-md-surface-dim flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-5xl">
        <header className="text-center mb-12">
          <ShieldCheck className="text-md-primary mx-auto mb-4" size={48} />
          <h1 className="text-headline-md font-extrabold text-md-on-surface mb-2">Pontufy Platform Console</h1>
          <p className="text-body-lg text-md-on-surface-variant">
            Bem-vindo, <strong className="text-md-on-surface">{ctx.email}</strong>
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-5 md:gap-6">
          {cards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="group md-card-outlined md-elevation-1 p-6 hover:shadow-xl hover:border-md-primary/40 transition-all duration-300"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="p-3 rounded-xl text-md-primary bg-md-primary-container/10 mb-4">
                    {card.icon}
                  </div>
                  <h2 className="text-title-lg font-bold text-md-on-surface mb-2 group-hover:text-md-primary transition-colors">
                    {card.title}
                  </h2>
                  <p className="text-body-md text-md-on-surface-variant mb-4">{card.description}</p>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-label-sm font-semibold ${card.badgeColor}`}>
                    {card.badge}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

async function countBlockedIps(): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const keys = await redis.keys('blocked-ip:*');
    return Array.isArray(keys) ? keys.length : 0;
  } catch {
    return 0;
  }
}
