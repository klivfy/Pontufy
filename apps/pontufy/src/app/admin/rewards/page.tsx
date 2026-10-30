'use client';

import { useEffect, useState } from 'react';
import { Gift, Loader2 } from 'lucide-react';
import RewardToggleRow from '@/components/admin/RewardToggleRow';

export default function AdminRewardsPage() {
  const [rewards, setRewards] = useState<{ id: string; title: string; partner: string; points: number; active: boolean }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/rewards', { cache: 'no-store' })
      .then((r) => r.json())
      .then((payload) => {
        setRewards(
          (payload.data || []).map((r: { id: string; title: string; partner?: string; pricePoints: number; isActive: boolean }) => ({
            id: r.id,
            title: r.title,
            partner: r.partner || 'Parceiro',
            points: r.pricePoints,
            active: r.isActive,
          })),
        );
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="animate-spin text-md-primary" size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 mb-1">
          <Gift className="text-md-primary" size={22} />
          <h1 className="text-title-lg font-bold text-md-on-surface">Recompensas</h1>
        </div>
        <p className="text-body-md text-md-on-surface-variant">
          Ative ou oculte itens do catálogo visível na loja dos colaboradores.
        </p>
      </header>
      <RewardToggleRow catalog={rewards} />
    </div>
  );
}
