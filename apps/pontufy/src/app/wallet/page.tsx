'use client';

import { useStore } from '@/store/useStore';
import { usePointsHistory } from '@/hooks/useApi';
import BalanceCard from '@/components/wallet/BalanceCard';
import PointsHistory from '@/components/wallet/PointsHistory';
import { Loader2 } from 'lucide-react';

function computeLevel(points: number) {
  if (points >= 5000)
    return { currentLevel: 'Especialista', nextLevel: 'Mestre', levelProgress: Math.min(100, ((points - 5000) / 5000) * 100) };
  if (points >= 2000)
    return { currentLevel: 'Analista Sênior', nextLevel: 'Especialista', levelProgress: ((points - 2000) / 3000) * 100 };
  if (points >= 500)
    return { currentLevel: 'Analista', nextLevel: 'Analista Sênior', levelProgress: ((points - 500) / 1500) * 100 };
  return { currentLevel: 'Iniciante', nextLevel: 'Analista', levelProgress: (points / 500) * 100 };
}

export default function WalletPage() {
  const currentUser = useStore((s) => s.currentUser);
  const pointsBalance = useStore((s) => s.currentPointsBalance);
  const { data: apiHistory, isLoading } = usePointsHistory();

  const level = computeLevel(pointsBalance);

  const history = (apiHistory || []).map((tx: any) => ({
    id: tx.id,
    type: tx.type as 'gain' | 'loss',
    description: tx.description,
    date: tx.timestamp ? new Date(tx.timestamp).toLocaleDateString('pt-BR') : tx.date || '',
    amount: tx.pointsAmount ?? tx.amount ?? 0,
  }));

  const userData = {
    pointsBalance,
    currentLevel: level.currentLevel,
    nextLevel: level.nextLevel,
    levelProgress: Math.round(level.levelProgress),
  };

  return (
    <main className="min-h-screen pb-20 pt-24 bg-md-surface-container-low">
      <div className="max-w-[1000px] mx-auto px-6 md:px-8">
        <header className="mb-8">
          <h1 className="text-3xl font-black text-md-on-surface tracking-tight">Central de Conquistas</h1>
          <p className="text-md-on-surface-variant mt-1.5 text-sm">
            {currentUser?.name ? `Olá, ${currentUser.name}! ` : ''}Acompanhe seu esforço e recompensas.
          </p>
        </header>

        <BalanceCard data={userData} />

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-md-tertiary" size={36} />
          </div>
        ) : history.length > 0 ? (
          <PointsHistory history={history} />
        ) : (
          <div className="bg-md-surface-container rounded-xl border border-md-outline p-8 text-center text-md-on-surface-variant">
            Nenhuma movimentação registrada ainda. Complete aulas para ganhar pontos!
          </div>
        )}
      </div>
    </main>
  );
}
