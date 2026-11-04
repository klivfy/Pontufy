import { Gift } from 'lucide-react';

import { getSessionContext } from '@/infra/session';
import { getTenantDb } from '@/infra/db';
import { listRewards } from '@/domain/rewards';
import MarketplaceClient from './MarketplaceClient';

// ═══════════════════════════════════════════════════════════════════════════
// C5 — Fronteira RSC: a vitrine.
//
// Antes: página 100% client, catálogo e saldo chegavam por SWR depois da
// hidratação — o colaborador via spinner com a loja vazia.
//
// Agora o servidor entrega a primeira página do catálogo e o saldo real na
// resposta inicial. O cliente cuida só do que é interativo (filtro, drawer de
// resgate, saldo reativo).
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export default async function MarketplacePage() {
  const { userId, tenantId } = await getSessionContext();

  // Catálogo inicial em paralelo com o saldo: duas leituras independentes.
  const [catalog, user] = await Promise.all([
    listRewards(tenantId, { page: 1, limit: 50 }),
    getTenantDb(tenantId).user.findFirst({
      where: { id: userId },
      select: { pointsBalance: true },
    }),
  ]);

  const initialRewards = (catalog as { data?: unknown[] }).data ?? [];
  const initialBalance = user?.pointsBalance ?? 0;

  return (
    <main className="min-h-screen pb-20 pt-24 bg-md-surface-dim">
      <div className="max-w-[1600px] mx-auto">
        <div className="px-8 md:px-16 mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Gift size={24} className="text-md-secondary" />
            <h1 className="text-3xl font-black text-md-on-surface tracking-tight">Clube de Benefícios</h1>
          </div>
          <p className="text-md-on-surface-variant text-sm">Troque seu esforço por recompensas reais.</p>
        </div>

        <MarketplaceClient
          initialRewards={initialRewards as never}
          initialBalance={initialBalance}
        />
      </div>
    </main>
  );
}
