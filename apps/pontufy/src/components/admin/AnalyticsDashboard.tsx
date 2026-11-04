'use client';

import { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import { Loader2 } from 'lucide-react';

interface EngagementData {
  date: string;
  completions: number;
  points: number;
}

interface SummaryData {
  totalUsers: number;
  totalCompletions: number;
  totalPointsAwarded: number;
  totalPointsRedeemed: number;
}

const CHART_COLORS = {
  primary: '#495453',
  secondary: '#6d5f52',
  tertiary: '#356a4c',
  highlight: '#a8433a',
};

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="md-card-outlined md-elevation-1 p-5 hover:shadow-lg transition-all duration-200">
      <p className="text-label-lg text-md-on-surface-variant mb-1">{label}</p>
      <p className="text-display-sm font-bold text-md-on-surface">{value.toLocaleString('pt-BR')}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="md-card-outlined md-elevation-1 p-6">
      <h3 className="text-title-lg font-bold text-md-on-surface mb-5">{title}</h3>
      <div style={{ height: 300 }}>{children}</div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;
  return (
    <div className="bg-md-surface-container border border-md-outline rounded-xl p-3 md-elevation-3">
      <p className="text-label-md text-md-on-surface-variant mb-1">{label}</p>
      {payload.map((entry: any, idx: number) => (
        <p key={idx} className="text-body-md font-semibold" style={{ color: entry.color }}>
          {entry.name}: {entry.value.toLocaleString('pt-BR')}
        </p>
      ))}
    </div>
  );
};

export default function AnalyticsDashboard() {
  const [engagement, setEngagement] = useState<EngagementData[]>([]);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/analytics')
      .then((r) => r.json())
      .then((data) => {
        setEngagement(data.engagement || []);
        setSummary(data.summary || null);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-md-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Colaboradores" value={summary.totalUsers} />
          <StatCard label="Aulas Concluídas" value={summary.totalCompletions} />
          <StatCard label="Pontos Distribuídos" value={summary.totalPointsAwarded} />
          <StatCard label="Pontos Resgatados" value={summary.totalPointsRedeemed} />
        </div>
      )}

      <ChartCard title="Aulas Concluídas por Dia">
        {engagement.length === 0 ? (
          <div className="h-full flex items-center justify-center text-md-on-surface-variant">
            Sem dados de engajamento ainda.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={engagement} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-md-outline-variant)" vertical={false} />
              <XAxis type="number" tick={{ fontSize: 12, fill: 'var(--color-md-on-surface-variant)' }} />
              <YAxis dataKey="date" type="category" width={80} tick={{ fontSize: 12, fill: 'var(--color-md-on-surface-variant)' }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="completions" fill="var(--color-md-primary)" radius={[0, 4, 4, 0]} name="Conclusões" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Pontos Distribuídos por Dia">
        {engagement.length === 0 ? (
          <div className="h-full flex items-center justify-center text-md-on-surface-variant">
            Sem dados de pontos ainda.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={engagement}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-md-outline-variant)" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--color-md-on-surface-variant)' }} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--color-md-on-surface-variant)' }} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="points"
                stroke="var(--color-md-tertiary)"
                strokeWidth={3}
                dot={{ r: 4, fill: 'var(--color-md-tertiary)', strokeWidth: 2 }}
                activeDot={{ r: 6, fill: 'var(--color-md-tertiary)' }}
                name="Pontos"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}