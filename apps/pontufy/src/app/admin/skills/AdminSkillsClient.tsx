'use client';

import { useEffect, useState } from 'react';
import { Loader2, TreePine, Target, ArrowLeft, Send, Users, Plus, BookOpen } from 'lucide-react';

// TAREFA 12.5 — Painel de trilhas + PDI do RH (MD3).

interface NodeRow {
  id: string;
  title: string;
  x: number;
  y: number;
  requiredScore: number;
  courseId: string | null;
  prerequisiteId: string | null;
}

interface SkillRow {
  id: string;
  name: string;
  category: string;
  targetLevel: number;
  nodes: NodeRow[];
}

interface UserRow {
  id: string;
  name: string;
  email: string;
}

interface PdiRow {
  userId: string;
  userName: string;
  nodeId: string;
  nodeTitle: string;
  skillName: string;
  createdAt: string;
}

export default function AdminSkillsClient() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [pdis, setPdis] = useState<PdiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form de criação
  const [skillName, setSkillName] = useState('');
  const [skillCategory, setSkillCategory] = useState('leadership');
  const [targetLevel, setTargetLevel] = useState(4);

  // Form de PDI
  const [pdiUserId, setPdiUserId] = useState('');
  const [pdiNodeId, setPdiNodeId] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [skillsRes, invRes, pdiRes] = await Promise.all([
        fetch('/api/admin/skills', { cache: 'no-store' }),
        fetch('/api/invitations', { cache: 'no-store' }),
        fetch('/api/admin/skills/pdi', { cache: 'no-store' }),
      ]);
      const skillsData = await skillsRes.json();
      const invData = await invRes.json();
      const pdiData = await pdiRes.json();
      if (skillsRes.ok) setSkills(skillsData.skills ?? []);
      if (invRes.ok) setUsers(invData.users ?? []);
      if (pdiRes.ok) setPdis(pdiData.pdis ?? []);
    } catch {
      setMessage({ type: 'error', text: 'Erro ao carregar dados.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreateSkill = async () => {
    if (!skillName.trim()) {
      setMessage({ type: 'error', text: 'Informe o nome da competência.' });
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: skillName.trim(), category: skillCategory, targetLevel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Erro ao criar.' });
        return;
      }
      setMessage({ type: 'success', text: `Competência "${skillName.trim()}" criada.` });
      setSkillName('');
      await load();
    } catch {
      setMessage({ type: 'error', text: 'Erro ao criar competência.' });
    } finally {
      setCreating(false);
    }
  };

  const handleAssignPdi = async () => {
    if (!pdiUserId || !pdiNodeId) {
      setMessage({ type: 'error', text: 'Selecione colaborador e nó da árvore.' });
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/skills/pdi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: pdiUserId, skillNodeId: pdiNodeId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Erro ao vincular PDI.' });
        return;
      }
      setMessage({ type: 'success', text: 'Nó vinculado ao PDI do colaborador.' });
      await load();
    } catch {
      setMessage({ type: 'error', text: 'Erro ao vincular PDI.' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div>
            <h1 className="text-headline-md font-extrabold text-md-on-surface flex items-center gap-2">
              <TreePine className="text-md-primary" size={28} /> Trilhas de Competência
            </h1>
            <p className="text-body-md text-md-on-surface-variant mt-1">
              Crie competências corporativas e vincule nós de PDI ao desenvolvimento individual dos colaboradores.
            </p>
          </div>
        </div>
      </header>

      {message && (
        <div
          className={`text-body-sm p-3 rounded-xl text-center font-medium ${
            message.type === 'success'
              ? 'bg-md-tertiary-container/20 border border-md-tertiary-container/30 text-md-on-tertiary-container'
              : 'bg-md-error/10 border border-md-error/30 text-md-error'
          }`}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-md-primary" size={26} />
        </div>
      ) : (
        <>
          {/* ── Nova competência ─────────────────────────────────────── */}
          <section className="md-card-outlined md-elevation-1 p-6">
            <h2 className="text-label-lg font-bold text-md-on-surface uppercase tracking-wider mb-5 flex items-center gap-2">
              <Plus size={18} className="text-md-primary" /> Nova Competência
            </h2>
            <div className="grid sm:grid-cols-4 gap-3 mb-4">
              <input
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                placeholder="Ex.: Liderança"
                className="sm:col-span-2 px-4 py-3 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface placeholder:text-md-on-surface-variant focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
              />
              <select
                value={skillCategory}
                onChange={(e) => setSkillCategory(e.target.value)}
                className="px-4 py-3 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
              >
                <option value="leadership">Liderança</option>
                <option value="compliance">Compliance</option>
                <option value="tech">Tecnologia</option>
                <option value="health">Saúde</option>
                <option value="retail">Varejo</option>
                <option value="industry">Indústria</option>
                <option value="general">Geral</option>
              </select>
              <select
                value={targetLevel}
                onChange={(e) => setTargetLevel(Number(e.target.value))}
                className="px-4 py-3 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
              >
                {[3, 4, 5].map((l) => (
                  <option key={l} value={l}>Nível-alvo {l}</option>
                ))}
              </select>
            </div>
            <p className="text-body-sm text-md-on-surface-variant mb-4">
              Os nós da árvore são criados ao vincular cursos existentes — os primeiros nós ficam
              disponíveis automaticamente; os seguintes exigem ≥ 80% no pré-requisito.
            </p>
            <button
              type="button"
              onClick={handleCreateSkill}
              disabled={creating}
              className="md-btn md-btn-filled flex items-center justify-center gap-2"
            >
              {creating ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              Criar competência
            </button>
          </section>

          {/* ── Trilhas existentes ───────────────────────────────────── */}
          <section className="md-card-outlined md-elevation-1 p-6">
            <h2 className="text-label-lg font-bold text-md-on-surface uppercase tracking-wider mb-5 flex items-center gap-2">
              <BookOpen size={18} className="text-md-primary" /> Trilhas Publicadas
            </h2>
            {skills.length === 0 ? (
              <div className="text-center py-12">
                <TreePine size={48} className="mx-auto text-md-on-surface-variant mb-4" />
                <p className="text-body-md text-md-on-surface-variant">Nenhuma competência criada ainda.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {skills.map((s) => (
                  <div key={s.id} className="bg-md-surface-container-high border border-md-outline rounded-xl p-5 hover:border-md-primary/30 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-semibold text-md-on-surface">{s.name}</p>
                      <span className="text-label-sm font-bold uppercase text-md-on-tertiary-container bg-md-tertiary-container/20 border border-md-tertiary-container/30 rounded-full px-2 py-0.5">
                        {s.category}
                      </span>
                    </div>
                    <p className="text-body-sm text-md-on-surface-variant mb-3">{s.nodes.length} nós · nível-alvo {s.targetLevel}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {s.nodes.map((n) => (
                        <span
                          key={n.id}
                          title={`${n.title}${n.prerequisiteId ? ' (requer pré-requisito)' : ' (raiz)'}`}
                          className="text-label-sm font-mono text-md-on-surface-variant bg-md-surface-container border border-md-outline rounded px-2 py-0.5 truncate max-w-[120px]"
                        >
                          {n.title.length > 14 ? `${n.title.slice(0, 13)}…` : n.title}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── PDI ──────────────────────────────────────────────────── */}
          <section className="md-card-outlined md-elevation-1 p-6">
            <h2 className="text-label-lg font-bold text-md-on-surface uppercase tracking-wider mb-5 flex items-center gap-2">
              <Target size={18} className="text-md-primary" /> Plano de Desenvolvimento Individual
            </h2>
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <select
                value={pdiUserId}
                onChange={(e) => setPdiUserId(e.target.value)}
                className="px-4 py-3 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
              >
                <option value="">Colaborador…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
              <select
                value={pdiNodeId}
                onChange={(e) => setPdiNodeId(e.target.value)}
                className="px-4 py-3 bg-md-surface-container border border-md-outline rounded-xl text-md-on-surface focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/20 text-body-md transition-colors"
              >
                <option value="">Nó da árvore…</option>
                {skills.flatMap((s) =>
                  s.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {s.name} → {n.title}
                    </option>
                  )),
                )}
              </select>
              <button
                type="button"
                onClick={handleAssignPdi}
                disabled={creating}
                className="md-btn md-btn-filled flex items-center justify-center gap-2"
              >
                {creating ? <Loader2 size={18} className="animate-spin" /> : <Target size={18} />}
                Vincular ao PDI
              </button>
            </div>

            {pdis.length > 0 && (
              <div className="mt-5">
                <p className="text-label-sm text-md-on-surface-variant uppercase tracking-wider font-semibold mb-3">PDIs ativos</p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {pdis.map((p, i) => (
                    <div key={`${p.userId}-${p.nodeId}-${i}`} className="flex items-center justify-between bg-md-surface-container border border-md-outline rounded-xl px-4 py-3 text-body-sm">
                      <div>
                        <span className="font-semibold text-md-on-surface">{p.userName}</span>
                        <span className="text-md-on-surface-variant ml-2">→ {p.skillName}: {p.nodeTitle}</span>
                      </div>
                        <span className="text-label-sm text-md-on-surface-variant">{new Date(p.createdAt).toLocaleDateString('pt-BR')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}