'use client';
import Image from 'next/image';
import { Gift, Lock } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { getPartnerDisplayName, getPartnerIcon, type Partner } from '@/lib/affiliate-engine';

interface RewardCardProps {
  id: string;
  title: string;
  pricePoints: number;
  imageUrl: string | null;
  partnerStore: string;
  category: string | null;
  isActive: boolean;
  onRedeem: (rewardId: string) => void;
}

export function RewardCard({
  id,
  title,
  pricePoints,
  imageUrl,
  partnerStore,
  category,
  isActive,
  onRedeem,
}: RewardCardProps) {
  const pointsBalance = useStore((s) => s.currentPointsBalance);
  const canAfford = pointsBalance >= pricePoints;
  const missingPoints = pricePoints - pointsBalance;

  const partner = partnerStore as Partner;
  const partnerDisplay = getPartnerDisplayName(partner);
  const partnerIcon = getPartnerIcon(partner);

  if (!isActive) return null;

  return (
    <article className="group relative bg-md-surface border border-md-outline rounded-2xl overflow-hidden transition-all duration-300 hover:border-md-primary/40 hover:shadow-lg hover:shadow-md-primary/10">
      <div className="relative aspect-[4/3] overflow-hidden bg-md-surface-dim">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-6xl">
            {partnerIcon}
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <div className="absolute top-3 right-3">
          <span className="bg-black/80 backdrop-blur-sm text-white text-xs font-medium px-2 py-1 rounded-full border border-md-outline">
            {partnerIcon} {partnerDisplay}
          </span>
        </div>

        {category && (
          <div className="absolute bottom-3 left-3">
            <span className="bg-md-tertiary/20 backdrop-blur-sm text-md-tertiary text-xs font-medium px-2 py-1 rounded-full border border-md-tertiary/30">
              {category}
            </span>
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        <h3 className="font-semibold text-md-on-surface text-base line-clamp-2 group-hover:text-md-primary-container transition-colors">
          {title}
        </h3>

        <div className="flex items-center justify-between pt-2 border-t border-md-outline">
          {/* Badge de pontos — SEMPRE terciário (#a1c0ae), padrão MD3 obrigatório */}
          <div className="flex items-center gap-2">
            <Gift size={16} className="text-md-tertiary" />
            <span className="font-bold text-md-tertiary text-lg">{pricePoints.toLocaleString('pt-BR')}</span>
            <span className="text-md-on-surface-variant text-sm">pontos</span>
          </div>

          <button
            onClick={() => onRedeem(id)}
            disabled={!canAfford}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
              canAfford
                ? 'bg-md-primary text-md-on-primary hover:bg-md-primary-container active:scale-[0.98]'
                : 'bg-md-surface-container-low text-md-on-surface-variant border border-md-outline-variant cursor-not-allowed'
            }`}
          >
            {canAfford ? (
              <>
                <Gift size={14} />
                Resgatar
              </>
            ) : (
              <>
                <Lock size={14} />
                Faltam {missingPoints.toLocaleString('pt-BR')}
              </>
            )}
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-md-on-surface-variant">
          <span>Saldo: <span className="font-medium text-md-on-surface">{pointsBalance.toLocaleString('pt-BR')}</span> pts</span>
          <span className={canAfford ? 'text-md-tertiary' : 'text-md-error'}>
            {canAfford ? `Novo saldo: ${(pointsBalance - pricePoints).toLocaleString('pt-BR')}` : `Faltam ${missingPoints.toLocaleString('pt-BR')}`}
          </span>
        </div>
      </div>
    </article>
  );
}