'use client';

import { useState } from 'react';
import { Gift, ExternalLink } from 'lucide-react';

interface RewardItem {
  id: string;
  title: string;
  partner: string;
  points: number;
  active: boolean;
}

export default function RewardToggleRow({ catalog }: { catalog: RewardItem[] }) {
  const [items, setItems] = useState<RewardItem[]>(catalog);

  const handleToggle = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    const newActive = !item.active;
    setItems(items.map((i) => (i.id === id ? { ...i, active: newActive } : i)));

    try {
      const res = await fetch(`/api/rewards`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId: id, isActive: newActive }),
      });
      if (!res.ok) {
        setItems(items.map((i) => (i.id === id ? { ...i, active: !newActive } : i)));
      }
    } catch {
      setItems(items.map((i) => (i.id === id ? { ...i, active: !newActive } : i)));
    }
  };

  if (items.length === 0) {
    return (
      <div className="md-card-outlined md-elevation-1 p-8 text-center">
        <Gift size={48} className="mx-auto text-md-on-surface-variant mb-4" />
        <p className="text-body-md text-md-on-surface-variant">Nenhuma recompensa cadastrada</p>
        <p className="text-body-sm text-md-on-surface-variant mt-1">Adicione recompensas via API ou importe do catálogo</p>
      </div>
    );
  }

  return (
    <div className="md-card-outlined md-elevation-1 overflow-hidden">
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-md-outline bg-md-surface-container-high/50">
        <div className="flex items-center gap-2 mb-1">
          <Gift className="text-md-primary flex-shrink-0" size={20} />
          <h2 className="text-title-lg font-bold text-md-on-surface">Controle do Catálogo de Recompensas</h2>
        </div>
        <p className="text-body-sm text-md-on-surface-variant">
          Gerencie quais prêmios estarão visíveis no Clube de Benefícios da sua empresa.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[500px]">
          <thead>
            <tr className="bg-md-surface-container-high/50 text-md-on-surface-variant text-label-sm uppercase tracking-wider border-b border-md-outline">
              <th className="px-4 sm:px-6 py-3 font-semibold">Produto / Parceiro</th>
              <th className="px-3 sm:px-6 py-3 font-semibold text-center whitespace-nowrap">Pontos</th>
              <th className="px-3 sm:px-6 py-3 font-semibold text-center">Status</th>
              <th className="px-4 py-3 font-semibold text-center">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-md-outline">
            {items.map((item) => (
              <tr
                key={item.id}
                className={`transition-colors ${
                  item.active ? 'hover:bg-md-surface-container-high/50' : 'opacity-60'
                }`}
              >
                <td className="px-4 sm:px-6 py-4">
                  <div className="font-semibold text-md-on-surface text-body-md">{item.title}</div>
                  <div className="text-body-sm font-medium text-md-on-surface-variant mt-0.5 uppercase tracking-wide">
                    {item.partner}
                  </div>
                </td>
                <td className="px-3 sm:px-6 py-4 text-center font-bold text-md-primary whitespace-nowrap">{item.points} pts</td>
                <td className="px-3 sm:px-6 py-4 text-center">
                  <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-label-sm font-semibold ${
                    item.active
                      ? 'bg-md-tertiary-container text-md-on-tertiary-container'
                      : 'bg-md-surface-container-high text-md-on-surface-variant'
                  }`}>
                    {item.active ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => handleToggle(item.id)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-md-primary focus:ring-offset-2 focus:ring-offset-md-surface ${
                      item.active ? 'bg-md-tertiary' : 'bg-md-outline'
                    }`}
                    aria-label={item.active ? 'Desativar recompensa' : 'Ativar recompensa'}
                    aria-pressed={item.active}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-md-surface-container-lowest transition-transform shadow-sm ${
                        item.active ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}