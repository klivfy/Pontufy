import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface PointsHistoryProps {
  history: {
    id: string;
    type: 'gain' | 'loss';
    description: string;
    date: string;
    amount: number;
  }[];
}

export default function PointsHistory({ history }: PointsHistoryProps) {
  return (
    <div className="bg-md-surface-container rounded-2xl border border-md-outline overflow-hidden mb-12">
      <div className="px-6 py-4 border-b border-md-outline">
        <h2 className="text-base font-bold text-md-on-surface">Extrato Digital</h2>
        <p className="text-xs text-md-on-surface-variant mt-0.5">Histórico cronológico de movimentações.</p>
      </div>

      <div className="divide-y divide-md-outline-variant">
        {history.map((tx) => (
          <div
            key={tx.id}
            className="p-4 sm:p-5 flex items-center justify-between hover:bg-md-surface-container transition-colors"
          >
            <div className="flex items-center gap-3.5">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                  tx.type === 'gain'
                    ? 'bg-md-tertiary/25 text-md-tertiary'
                    : 'bg-md-error/25 text-md-error'
                }`}
              >
                {tx.type === 'gain' ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
              </div>

              <div>
                <div className="font-semibold text-md-on-surface text-sm">{tx.description}</div>
                <div className="text-xs text-md-on-surface-muted mt-0.5">{tx.date}</div>
              </div>
            </div>

            <div
              className={`font-black text-base tabular-nums ${
                tx.type === 'gain' ? 'text-md-tertiary' : 'text-md-error'
              }`}
            >
              {tx.type === 'gain' ? '+' : '-'}
              {tx.amount} pts
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
