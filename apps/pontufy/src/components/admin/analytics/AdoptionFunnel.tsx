import { Users, Sparkles, Info } from 'lucide-react';

import type { AdoptionReport } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// Funil de adoção
//
// O painel respondia "quanto a empresa consumiu". Este bloco responde "quanta
// gente da base chegou a usar". Três degraus e a nota do que ele NÃO mede —
// número sem a ressalva vira promessa.
// ═══════════════════════════════════════════════════════════════════════════

const STAGE_FILL: Record<string, string> = {
  eligible: 'bg-md-outline',
  started: 'bg-md-primary',
  completers: 'bg-md-tertiary',
};

function formatDays(days: number | null): string {
  if (days === null) return '—';
  if (days < 1) return 'no mesmo dia';
  return days === 1 ? '1 dia' : `${days} dias`;
}

export default function AdoptionFunnel({ adoption }: { adoption: AdoptionReport }) {
  const { funnel, stages, lessonsPerLearner, medianDaysToFirstLesson, byDepartment, blindSpot } =
    adoption;

  const noLearners = stages.started === 0;

  return (
    <section className="bg-md-surface-container border border-md-outline rounded-2xl p-6">
      <h2 className="text-sm font-bold text-md-on-surface uppercase tracking-wide mb-1 flex items-center gap-2">
        <Users size={16} className="text-md-tertiary" /> Funil de Adoção
      </h2>
      <p className="text-xs text-md-on-surface-variant mb-5">
        Quanta gente da base chegou a aprender — não só quanto foi consumido
      </p>

      {noLearners ? (
        <p className="text-sm text-md-on-surface-variant">
          Nenhum colaborador concluiu uma aula ainda. O funil só ganha leitura depois da
          primeira conclusão.
        </p>
      ) : (
        <>
          <ol className="space-y-3 mb-6">
            {funnel.map((stage) => (
              <li key={stage.key}>
                <div className="flex items-baseline justify-between gap-4 mb-1.5">
                  <span className="text-sm font-medium text-md-on-surface">{stage.label}</span>
                  <span className="text-sm tabular-nums text-md-on-surface-variant">
                    <strong className="text-md-on-surface">{stage.users}</strong>
                    <span className="mx-1.5 text-md-outline">·</span>
                    {stage.shareOfEligible}%
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-md-surface-container-high overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${STAGE_FILL[stage.key] ?? 'bg-md-primary'}`}
                    style={{ width: `${Math.min(100, Math.max(stage.users > 0 ? 2 : 0, stage.shareOfEligible))}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <div className="rounded-xl border border-md-outline-variant bg-md-surface-container-low px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-md-on-surface-variant mb-1">
                Aulas por aprendiz
              </p>
              <p className="text-xl font-bold text-md-on-surface tabular-nums">
                {lessonsPerLearner.toFixed(1)}
              </p>
            </div>
            <div className="rounded-xl border border-md-outline-variant bg-md-surface-container-low px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-md-on-surface-variant mb-1">
                Mediana até a 1ª aula
              </p>
              <p className="text-xl font-bold text-md-on-surface">
                {formatDays(medianDaysToFirstLesson)}
              </p>
            </div>
          </div>

          {byDepartment.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-md-on-surface-variant border-b border-md-outline-variant">
                    <th className="py-2 pr-4 font-semibold">Departamento</th>
                    <th className="py-2 pr-4 font-semibold text-right">Elegíveis</th>
                    <th className="py-2 pr-4 font-semibold text-right">Começaram</th>
                    <th className="py-2 font-semibold text-right">Taxa</th>
                  </tr>
                </thead>
                <tbody>
                  {byDepartment.slice(0, 8).map((row) => (
                    <tr key={row.department} className="border-b border-md-outline-variant/60 last:border-0">
                      <td className="py-2 pr-4 text-md-on-surface">{row.department}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-md-on-surface-variant">
                        {row.eligible}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-md-on-surface-variant">
                        {row.started}
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium text-md-on-surface">
                        {row.startRate}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="mt-5 flex gap-2 text-xs leading-relaxed text-md-on-surface-variant">
        <Info size={14} className="mt-0.5 shrink-0 text-md-outline" aria-hidden />
        <span>{blindSpot}</span>
      </p>

      {!noLearners && stages.completers > 0 && (
        <p className="mt-3 flex gap-2 text-xs leading-relaxed text-md-on-surface-variant">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-md-tertiary" aria-hidden />
          <span>
            {stages.completers}{' '}
            {stages.completers === 1 ? 'pessoa terminou' : 'pessoas terminaram'} ao menos um curso
            inteiro — é esse grupo que costuma puxar o resto da equipe.
          </span>
        </p>
      )}
    </section>
  );
}
