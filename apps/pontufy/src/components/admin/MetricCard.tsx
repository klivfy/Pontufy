import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

type TrendType = 'positive' | 'negative' | 'neutral';

interface MetricCardProps {
  title: string;
  value: string;
  trend: string;
  trendType?: TrendType;
}

const TREND_CONFIG: Record<TrendType, { icon: typeof TrendingUp; color: string; bg: string }> = {
  positive: { icon: TrendingUp, color: 'text-md-tertiary', bg: 'bg-md-tertiary-container/20' },
  negative: { icon: TrendingDown, color: 'text-md-secondary', bg: 'bg-md-secondary-container/20' },
  neutral: { icon: Minus, color: 'text-md-on-surface-variant', bg: 'bg-md-surface-container-high/50' },
};

export default function MetricCard({ title, value, trend, trendType = 'neutral' }: MetricCardProps) {
  const config = TREND_CONFIG[trendType];

  return (
    <div className="md-card-outlined md-elevation-1 p-5 sm:p-6 hover:shadow-lg transition-all duration-200">
      <h3 className="text-label-lg text-md-on-surface-variant mb-3">{title}</h3>
      <div className="text-display-sm font-bold text-md-on-surface mb-3">{value}</div>
      <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full ${config.bg} border border-current/20`}>
        <config.icon size={14} className={config.color} aria-hidden="true" />
        <span className={`text-label-sm font-semibold ${config.color}`}>{trend}</span>
      </div>
    </div>
  );
}