'use client';

import { Users, BookOpenCheck, Coins, Gift } from 'lucide-react';
import type { AnalyticsSummary } from './types';

const formatNumber = (value: number): string => new Intl.NumberFormat('pt-BR').format(value);

interface MetricsCardsProps {
  summary: AnalyticsSummary;
}

interface KpiCardProps {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  accent: string;
}

function KpiCard({ label, value, hint, icon, accent }: KpiCardProps) {
  return (
    <div className="bg-md-surface-container border border-md-outline rounded-2xl p-5 flex flex-col justify-between min-h-[130px]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-md-on-surface-variant uppercase tracking-wide">{label}</p>
        <span
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${accent}1A`, color: accent }}
        >
          {icon}
        </span>
      </div>
      <p className="text-2xl font-black text-md-on-surface mt-2">{value}</p>
      <p className="text-[11px] text-md-on-surface-variant mt-0.5">{hint}</p>
    </div>
  );
}

export default function MetricsCards({ summary }: MetricsCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <KpiCard
        label="Colaboradores Ativos"
        value={formatNumber(summary.activeUsers)}
        hint={`de ${formatNumber(summary.totalUsers)} no total`}
        icon={<Users size={17} />}
        accent="#495453"
      />
      <KpiCard
        label="Aulas Concluídas"
        value={formatNumber(summary.totalCompletions)}
        hint={`em ${formatNumber(summary.totalCourses)} cursos`}
        icon={<BookOpenCheck size={17} />}
        accent="#6d5f52"
      />
      <KpiCard
        label="Pontos Distribuídos"
        value={formatNumber(summary.totalPointsAwarded)}
        hint="últimos 30 dias"
        icon={<Coins size={17} />}
        accent="#3B82F6"
      />
      <KpiCard
        label="Pontos Resgatados"
        value={formatNumber(summary.totalPointsRedeemed)}
        hint="benefícios consumidos"
        icon={<Gift size={17} />}
        accent="#F59E0B"
      />
    </div>
  );
}
