'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Lock, CheckCircle2, PlayCircle, Target } from 'lucide-react';

// TAREFA 12.2 — Árvore de Habilidades interativa em SVG (estética MD3).
// Nós: locked (cinza) / available (primária) / in_progress (secundária) /
// completed (terciária, check). PDI recebe alvo destacado.

export interface SkillNodeView {
  id: string;
  title: string;
  description: string | null;
  x: number;
  y: number;
  requiredScore: number;
  courseId: string | null;
  prerequisiteId: string | null;
  status: 'locked' | 'available' | 'in_progress' | 'completed';
  score: number;
  pdiTarget: boolean;
}

export interface SkillView {
  id: string;
  name: string;
  category: string;
  targetLevel: number;
  proficiencyLevel: number;
  proficiencyPercent: number;
  nodes: SkillNodeView[];
}

const NODE_RADIUS = 34;
const VIEW_PAD = 60;

const STATUS_COLORS: Record<SkillNodeView['status'], { fill: string; stroke: string; text: string }> = {
  locked: { fill: '#e5e1d9', stroke: '#cac4bd', text: '#848484' },
  available: { fill: '#cad9ca', stroke: '#495453', text: '#1f2a29' },
  in_progress: { fill: '#495453', stroke: '#495453', text: '#ffffff' },
  completed: { fill: '#a7e3c1', stroke: '#356a4c', text: '#0a2a1a' },
};

export default function SkillTree({ skills }: { skills: SkillView[] }) {
  const [selected, setSelected] = useState<SkillNodeView | null>(null);

  if (skills.length === 0) {
    return (
      <div className="bg-md-surface border border-md-outline rounded-xl p-10 text-center">
        <p className="text-md-on-surface-variant text-sm">
          Nenhuma trilha de competência publicada ainda. Peça ao seu gestor para criar a árvore de habilidades.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {skills.map((skill) => (
        <SkillBranch
          key={skill.id}
          skill={skill}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
        />
      ))}

      {selected && (
        <NodeDetail node={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function SkillBranch({
  skill,
  selectedId,
  onSelect,
}: {
  skill: SkillView;
  selectedId: string | null;
  onSelect: (n: SkillNodeView | null) => void;
}) {
  const { width, height, edges } = useMemo(() => {
    const xs = skill.nodes.map((n) => n.x);
    const ys = skill.nodes.map((n) => n.y);
    const minX = xs.length ? Math.min(...xs) : 0;
    const minY = ys.length ? Math.min(...ys) : 0;
    const maxX = xs.length ? Math.max(...xs) : 0;
    const maxY = ys.length ? Math.max(...ys) : 0;
    const w = Math.max(400, maxX - minX + VIEW_PAD * 2);
    const h = Math.max(240, maxY - minY + VIEW_PAD * 2);

    const byId = new Map(skill.nodes.map((n) => [n.id, n]));
    const e = skill.nodes
      .filter((n) => n.prerequisiteId && byId.has(n.prerequisiteId))
      .map((n) => ({ from: byId.get(n.prerequisiteId as string)!, to: n }));

    return { width: w, height: h, edges: e };
  }, [skill.nodes]);

  const levelColor =
    skill.proficiencyLevel >= 4 ? 'text-md-tertiary' : skill.proficiencyLevel >= 3 ? 'text-md-secondary' : 'text-md-on-surface-variant';

  return (
    <section className="bg-md-surface border border-md-outline rounded-xl p-5">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-black text-md-on-surface">{skill.name}</h2>
          <p className="text-xs text-md-on-surface-variant uppercase tracking-wider mt-0.5">{skill.category}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-36">
            <div className="flex justify-between text-[10px] font-bold text-md-on-surface-variant mb-1">
              <span>Proficiência</span>
              <span className={levelColor}>Nv. {skill.proficiencyLevel}/{skill.targetLevel}</span>
            </div>
            <div className="h-1.5 bg-md-outline rounded-full overflow-hidden">
              <div
                className="h-full bg-md-tertiary rounded-full transition-all"
                style={{ width: `${skill.proficiencyPercent}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[560px]" role="img" aria-label={`Árvore de habilidades de ${skill.name}`}>
          {/* Conexões de pré-requisito */}
          {edges.map(({ from, to }) => {
            const completed = to.status !== 'locked';
            return (
              <line
                key={`${from.id}-${to.id}`}
                x1={from.x + VIEW_PAD}
                y1={from.y + VIEW_PAD}
                x2={to.x + VIEW_PAD}
                y2={to.y + VIEW_PAD}
                stroke={completed ? '#356a4c' : '#cac4bd'}
                strokeWidth={2}
                strokeDasharray={completed ? undefined : '5 4'}
              />
            );
          })}

          {/* Nós */}
          {skill.nodes.map((node) => {
            const c = STATUS_COLORS[node.status];
            const cx = node.x + VIEW_PAD;
            const cy = node.y + VIEW_PAD;
            return (
              <g
                key={node.id}
                onClick={() => onSelect(node)}
                className="cursor-pointer"
                role="button"
                aria-label={`${node.title} — ${node.status}`}
              >
                <circle cx={cx} cy={cy} r={NODE_RADIUS} fill={c.fill} stroke={c.stroke} strokeWidth={node.pdiTarget ? 3 : 1.5} />
                {node.status === 'completed' ? (
                  <CheckCircle2 x={cx - 12} y={cy - 12} size={24} className="text-md-on-highlight" />
                ) : node.status === 'locked' ? (
                  <Lock x={cx - 10} y={cy - 10} size={20} color="#848484" />
                ) : (
                  <PlayCircle x={cx - 11} y={cy - 11} size={22} className="text-md-on-surface" />
                )}
                {node.pdiTarget && (
                  <Target x={cx + NODE_RADIUS - 14} y={cy - NODE_RADIUS + 2} size={14} className="text-md-highlight" />
                )}
                <text
                  x={cx}
                  y={cy + NODE_RADIUS + 14}
                  textAnchor="middle"
                  className="fill-md-outline text-[10px] font-semibold uppercase tracking-wide"
                >
                  {node.title.length > 16 ? `${node.title.slice(0, 15)}…` : node.title}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function NodeDetail({ node, onClose }: { node: SkillNodeView; onClose: () => void }) {
  const statusLabel: Record<SkillNodeView['status'], string> = {
    locked: 'Bloqueado',
    available: 'Disponível',
    in_progress: 'Em progresso',
    completed: 'Concluído',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-md-surface border border-md-outline rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="font-black text-md-on-surface text-lg">{node.title}</h3>
        <p className="text-sm text-md-on-surface-variant mt-1">{node.description ?? 'Sem descrição.'}</p>

        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between text-md-on-surface-variant">
            <span>Status</span>
            <span className="font-bold text-md-on-surface">{statusLabel[node.status]}</span>
          </div>
          <div className="flex justify-between text-md-on-surface-variant">
            <span>Nota exigida</span>
            <span className="font-bold text-md-on-surface">≥ {node.requiredScore}%</span>
          </div>
          {node.score > 0 && (
            <div className="flex justify-between text-md-on-surface-variant">
              <span>Sua nota</span>
              <span className="font-bold text-md-tertiary">{node.score}%</span>
            </div>
          )}
          {node.pdiTarget && (
            <p className="text-xs font-semibold text-md-highlight bg-md-highlight/10 border border-md-highlight/30 rounded-lg px-3 py-2">
              Meta do seu PDI — o RH definiu este nó para você.
            </p>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          {node.courseId && node.status !== 'locked' ? (
            <Link
              href={`/player/${node.courseId}`}
              className="flex-1 text-center px-4 py-2.5 rounded-xl font-bold text-md-on-primary bg-md-primary hover:bg-md-primary-container transition-colors text-sm"
            >
              Ir para o curso
            </Link>
          ) : (
            <div className="flex-1 px-4 py-2.5 rounded-xl font-bold bg-md-surface-container border border-md-outline text-md-on-surface-variant text-sm text-center">
              {node.status === 'locked' ? 'Conclua o pré-requisito para liberar' : 'Curso não vinculado'}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-md-outline text-md-on-surface-variant hover:text-md-on-surface transition-colors text-sm"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}