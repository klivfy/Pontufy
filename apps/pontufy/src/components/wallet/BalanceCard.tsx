import { Coins, TrendingUp } from 'lucide-react';

interface BalanceCardProps {
  data: {
    pointsBalance: number;
    currentLevel: string;
    nextLevel: string;
    levelProgress: number;
  };
}

export default function BalanceCard({ data }: BalanceCardProps) {
  return (
    <div className="bg-md-surface-container rounded-2xl border border-md-outline p-6 sm:p-8 mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
      {/* Balance Info */}
      <div>
        <div className="flex items-center gap-2 text-xs font-bold text-md-on-surface-variant uppercase tracking-widest mb-2">
          <Coins size={13} className="text-md-secondary" />
          Seu Saldo
        </div>
        <div className="flex items-end gap-3">
          <span className="text-5xl md:text-6xl font-black text-md-on-surface tracking-tighter">
            {data.pointsBalance.toLocaleString('pt-BR')}
          </span>
          <span className="text-lg text-md-tertiary font-bold mb-1">pts</span>
        </div>
      </div>

      {/* Level Progress */}
      <div className="w-full md:w-1/2">
        <div className="flex justify-between items-end mb-2">
          <div>
            <div className="text-[11px] font-bold text-md-on-surface-muted uppercase tracking-wider mb-0.5">Nível Atual</div>
            <div className="text-base font-black text-md-on-surface flex items-center gap-1.5">
              <TrendingUp size={15} className="text-md-tertiary" />
              {data.currentLevel}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold text-md-on-surface-muted uppercase tracking-wider mb-0.5">
              Próximo
            </div>
            <div className="text-sm font-bold text-md-tertiary">{data.nextLevel}</div>
          </div>
        </div>

        <div className="w-full h-1.5 bg-md-surface-container-high rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${data.levelProgress}%`,
              background: 'linear-gradient(90deg, #495453 0%, #a7e3c1 100%)',
            }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-md-on-surface-muted mt-1.5">
          <span>{data.levelProgress}% concluído</span>
          <span>{100 - data.levelProgress}% para {data.nextLevel}</span>
        </div>
      </div>
    </div>
  );
}
