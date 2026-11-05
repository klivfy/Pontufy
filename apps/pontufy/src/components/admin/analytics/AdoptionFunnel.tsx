import { Users, Sparkles, Info, DoorOpen } from 'lucide-react';

import type { AdoptionReport } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// Funil de adoção
//
// O painel respondia "quanto a empresa consumiu". Este bloco responde "quanta
// gente da base chegou a usar" e — o que faltava — **onde as pessoas param**.
//
// Quatro degraus: elegível → abriu → concluiu uma aula → concluiu um curso.
// A distância entre os dois primeiros e os dois últimos é o abandono, que
// aparece como número próprio em vez de ficar implícito na diferença.
// ═══════════════════════════════════════════════════════════════════════════

const STAGE_FILL: Record<string, string> = {
  eligible: 'bg-md-outline',
  opened: 'bg-md-secondary',
  completedOne: 'bg-md-primary',
  completers: 'bg-md-tertiary',
};

function formatDays(days: number | null): string {
  if (days === null) return '—';
  if (days < 1) return 'no mesmo dia';
  return days === 1 ? '1 dia' : `${days} dias`;
}

function formatSince(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('pt-BR');
}

export default function AdoptionFunnel({ adoption }: { adoption: AdoptionReport }) {
  const {
    funnel,
    stages,
    abandoned,
    abandonmentRate,
    lessonsPerLearner,
    opensPerLearner,
    medianDaysToFirstLesson,
    byDepartment,
    measuredSince,
    blindSpot,
  } = adoption;

  const since = formatSince(measuredSince);
  const nobodyOpened = stages.opened === 0;

  return (
    <section className="bg-md-surface-container border border-md-outline rounded-2xl p-6">
      <h2 className="text-sm font-bold text-md-on-surface uppercase tracking-wide mb-1 flex items-center gap-2">
        <Users size={16} className="text-md-tertiary" /> Funil de Adoção
      </h2>
      <p className="text-xs text-md-on-surface-variant mb-5">
        Quanta gente da base chegou a aprender — e onde as pessoas param
      </p>

      {nobodyOpened ? (
        <p className="text-sm text-md-on-surface-variant">
          Nenhuma aula foi aberta desde {since ?? 'o início da medição'}. O funil só ganha
          leitura depois da primeira abertura.
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
                    style={{
                      width: `${Math.min(100, Math.max(stage.users > 0 ? 2 : 0, stage.shareOfEligible))}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>

          {abandoned > 0 && (
            <div className="mb-6 flex gap-3 rounded-xl border border-md-highlight/40 bg-md-highlight/10 px-4 py-3">
              <DoorOpen size={18} className="mt-0.5 shrink-0 text-md-on-highlight" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-md-on-highlight">
                  {abandoned} {abandoned === 1 ? 'pessoa abriu' : 'pessoas abriram'} e não
                  concluíram nenhuma aula ({abandonmentRate}%)
                </p>
                <p className="text-xs text-md-on-surface-variant mt-1">
                  É aqui que o curso se perde. Abandono alto nos primeiros minutos costuma ser
                  aula longa, texto difícil ou expectativa errada na descrição.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <div className="rounded-xl border border-md-outline-variant bg-md-surface-container-low px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-md-on-surface-variant mb-1">
                Aberturas por pessoa
              </p>
              <p className="text-xl font-bold text-md-on-surface tabular-nums">{opensPerLearner}</p>
            </div>
            <div className="rounded-xl border border-md-outline-variant bg-md-surface-container-low px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-md-on-surface-variant mb-1">
                Aulas por quem concluiu
              </p>
              <p className="text-xl font-bold text-md-on-surface tabular-nums">{lessonsPerLearner}</p>
            </div>
            <div className="rounded-xl border border-md-outline-variant bg-md-surface-container-low px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-md-on-surface-variant mb-1">
                Mediana até a 1ª aula
              </p>
              <p className="text-xl font-bold text-md-on-surface">
                {formatDays(medianDaysToFirstLesson)}
              </p>
            </div>
            <div className="rounded-xl border border-md-outline-variant bg-md-surface-container-low px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-md-on-surface-variant mb-1">
                Abandono
              </p>
              <p className="text-xl font-bold text-md-on-surface tabular-nums">{abandonmentRate}%</p>
            </div>
          </div>

          {byDepartment.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-md-on-surface-variant border-b border-md-outline-variant">
                    <th className="py-2 pr-4 font-semibold">Departamento</th>
                    <th className="py-2 pr-4 font-semibold text-right">Elegíveis</th>
                    <th className="py-2 pr-4 font-semibold text-right">Abriram</th>
                    <th className="py-2 pr-4 font-semibold text-right">Concluíram</th>
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
                        {row.opened}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-md-on-surface-variant">
                        {row.completedOne}
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium text-md-on-surface">
                        {row.openRate}%
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

      {!nobodyOpened && stages.completers > 0 && (
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
