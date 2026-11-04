import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import AdminDashboardClient from './AdminDashboardClient';

// ═══════════════════════════════════════════════════════════════════════════
// O `AdminLayout` (sidebar + top bar) já vem de `src/app/admin/layout.tsx`.
// Esta página NÃO deve embrulhá-lo de novo — era o que duplicava a sidebar:
// duas árvores de navegação completas, uma ao lado da outra.
//
// A checagem de sessão continua aqui de propósito (defesa em profundidade):
// se o layout mudar ou a rota for reorganizada, a página não fica aberta.
// ═══════════════════════════════════════════════════════════════════════════

export default async function AdminDashboard() {
  const session = await auth();
  if (!session || session.user.role !== 'admin_rh') redirect('/dashboard');

  return <AdminDashboardClient />;
}
