import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@/backend/db';
import TenantsConsole from './TenantsConsole';

export default async function SuperAdminTenantsPage() {
  const session = await auth();

  if (
    !session?.user ||
    session.user.role !== 'super_admin' ||
    !session.user.email?.endsWith('@pontufy.com')
  ) {
    redirect('/superadmin/login');
  }

  // Visão consolidada global: única exceção ao Zero Trust, por design.
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      aiCredits: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      createdAt: true,
      _count: { select: { users: true, courses: true } },
    },
  });

  const totals = tenants.reduce(
    (acc, t) => ({
      tenants: acc.tenants + 1,
      users: acc.users + t._count.users,
      courses: acc.courses + t._count.courses,
      credits: acc.credits + t.aiCredits,
    }),
    { tenants: 0, users: 0, courses: 0, credits: 0 },
  );

  return (
    <div className="min-h-screen bg-md-surface-container-low px-4 py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              href="/superadmin"
              className="inline-flex items-center gap-1.5 text-sm text-md-on-surface-variant hover:text-md-on-surface transition-colors mb-2"
            >
              ← Voltar ao console
            </Link>
            <h1 className="text-2xl font-bold text-md-on-surface">Locatários & Consumo de IA</h1>
            <p className="text-sm text-md-on-surface-variant mt-1">
              Governança global · {session.user.email}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-md-surface-container border border-md-outline rounded-2xl p-5">
            <p className="text-xs text-md-on-surface-variant uppercase tracking-wide font-semibold">Empresas</p>
            <p className="text-2xl font-black text-md-on-surface mt-1">{totals.tenants}</p>
          </div>
          <div className="bg-md-surface-container border border-md-outline rounded-2xl p-5">
            <p className="text-xs text-md-on-surface-variant uppercase tracking-wide font-semibold">Utilizadores</p>
            <p className="text-2xl font-black text-md-on-surface mt-1">{totals.users}</p>
          </div>
          <div className="bg-md-surface-container border border-md-outline rounded-2xl p-5">
            <p className="text-xs text-md-on-surface-variant uppercase tracking-wide font-semibold">Cursos</p>
            <p className="text-2xl font-black text-md-on-surface mt-1">{totals.courses}</p>
          </div>
          <div className="bg-md-surface-container border border-md-outline rounded-2xl p-5">
            <p className="text-xs text-md-on-surface-variant uppercase tracking-wide font-semibold">Créditos de IA</p>
            <p className="text-2xl font-black text-md-on-surface mt-1">{totals.credits}</p>
          </div>
        </div>

        <TenantsConsole initialTenants={tenants} />
      </div>
    </div>
  );
}