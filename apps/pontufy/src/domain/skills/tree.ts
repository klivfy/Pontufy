import { getTenantDb } from '@/infra/db';
import { DomainError } from '@/domain/auth';

// ═══════════════════════════════════════════════════════════════════════════
// TAREFA 12 — Árvore de Habilidades: lógica central
//  • 12.3: pré-requisitos — nó fica "available" somente quando o pré-requisito
//    está completed com score >= requiredScore (padrão 80%).
//  • 12.4: proficiência por competência = nós completados / total de nós,
//    escalado para nível 1..5 (targetLevel é o teto da trilha).
//  • 12.5: PDI — nó apontado pelo RH (pdiTarget) entra como available imediato.
// ═══════════════════════════════════════════════════════════════════════════

export type NodeStatus = 'locked' | 'available' | 'in_progress' | 'completed';

export interface SkillTreeNodeView {
  id: string;
  title: string;
  description: string | null;
  x: number;
  y: number;
  requiredScore: number;
  courseId: string | null;
  prerequisiteId: string | null;
  status: NodeStatus;
  score: number;
  pdiTarget: boolean;
}

export interface SkillTreeView {
  id: string;
  name: string;
  category: string;
  targetLevel: number;
  proficiencyLevel: number; // 1..5 (12.4)
  proficiencyPercent: number;
  nodes: SkillTreeNodeView[];
}

export const SKILL_UNLOCK_SCORE = 80; // 12.3 — aprovação exigida no pré-requisito

export async function getSkillTree(tenantId: string, userId: string): Promise<SkillTreeView[]> {
  const db = getTenantDb(tenantId);

  const skills = await db.skill.findMany({
    where: { tenantId },
    include: {
      nodes: {
        include: { prerequisite: { select: { id: true } }, userProgress: { where: { userId } } },
      },
    },
    orderBy: { name: 'asc' },
  });

  const progressByNode = new Map<string, { status: NodeStatus; score: number; pdiTarget: boolean }>();
  for (const skill of skills) {
    for (const node of skill.nodes) {
      const p = node.userProgress[0];
      progressByNode.set(node.id, {
        status: (p?.status as NodeStatus) ?? 'locked',
        score: p?.score ?? 0,
        pdiTarget: p?.pdiTarget ?? false,
      });
    }
  }

  const result: SkillTreeView[] = [];

  for (const skill of skills) {
    const nodes: SkillTreeNodeView[] = [];

    for (const node of skill.nodes) {
      const progress = progressByNode.get(node.id)!;
      let status: NodeStatus = progress.status;

      // Reavaliação defensiva: um nó só é "completed" com score suficiente.
      if (status === 'completed' && progress.score < node.requiredScore) {
        status = progress.score > 0 ? 'in_progress' : 'locked';
      }

      // 12.3 — Desbloqueio por pré-requisito (avaliado em tempo real).
      if (status === 'locked') {
        if (progress.pdiTarget) {
          // 12.5 — PDI do RH libera o nó imediatamente.
          status = 'available';
        } else if (!node.prerequisiteId) {
          // Raiz da árvore: disponível por padrão.
          status = 'available';
        } else {
          const prereq = progressByNode.get(node.prerequisiteId);
          if (prereq && prereq.status === 'completed' && prereq.score >= (node.requiredScore || SKILL_UNLOCK_SCORE)) {
            status = 'available';
          }
        }
      }

      // Retenção do histórico: status derivado, sem referência ao nó pai na view.
      nodes.push({
        id: node.id,
        title: node.title,
        description: node.description,
        x: node.x,
        y: node.y,
        requiredScore: node.requiredScore,
        courseId: node.courseId,
        prerequisiteId: node.prerequisiteId,
        status,
        score: progress.score,
        pdiTarget: progress.pdiTarget,
      });
    }

    // 12.4 — Proficiência: completados / total, escalada ao teto da trilha.
    const total = nodes.length;
    const completed = nodes.filter((n) => n.status === 'completed').length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const proficiencyLevel = Math.max(1, Math.min(5, Math.round((percent / 100) * skill.targetLevel)));

    result.push({
      id: skill.id,
      name: skill.name,
      category: skill.category,
      targetLevel: skill.targetLevel,
      proficiencyLevel,
      proficiencyPercent: percent,
      nodes,
    });
  }

  return result;
}

// 12.3 — Aplicado no hook do quiz: aprovação >= 80% completa o nó e
// propaga o desbloqueio dos dependentes (avaliado na próxima leitura).
export async function recordNodeScore(
  tenantId: string,
  userId: string,
  skillNodeId: string,
  score: number,
): Promise<{ completed: boolean }> {
  const db = getTenantDb(tenantId);

  const node = await db.skillNode.findFirst({ where: { id: skillNodeId } });
  if (!node) return { completed: false };

  const completed = score >= node.requiredScore;

  await db.userSkillProgress.upsert({
    where: { userId_skillNodeId: { userId, skillNodeId } },
    create: {
      tenantId,
      userId,
      skillId: node.skillId,
      skillNodeId,
      score,
      status: completed ? 'completed' : 'in_progress',
      pdiTarget: false,
    },
    update: {
      score,
      status: completed ? 'completed' : 'in_progress',
    },
  });

  return { completed };
}

// 12.5 — RH vincula um nó ao PDI do colaborador (libera como available).
export async function assignPdiNode(
  tenantId: string,
  userId: string,
  skillNodeId: string,
): Promise<void> {
  const db = getTenantDb(tenantId);
  const node = await db.skillNode.findFirst({ where: { id: skillNodeId } });
  if (!node) throw new DomainError('Nó de habilidade não encontrado.', 404);

  await db.userSkillProgress.upsert({
    where: { userId_skillNodeId: { userId, skillNodeId } },
    create: {
      tenantId,
      userId,
      skillId: node.skillId,
      skillNodeId,
      score: 0,
      status: 'available',
      pdiTarget: true,
    },
    update: { pdiTarget: true, status: 'available' },
  });
}

// 12.5 — Lista de PDIs ativos do tenant (para o gestor de RH).
export async function listPdiTargets(tenantId: string): Promise<
  Array<{ userId: string; userName: string; nodeId: string; nodeTitle: string; skillName: string; createdAt: string }>
> {
  const db = getTenantDb(tenantId);
  const rows = await db.userSkillProgress.findMany({
    where: { tenantId, pdiTarget: true },
    include: {
      user: { select: { name: true } },
      skillNode: { select: { title: true } },
      skill: { select: { name: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return rows.map((r: any) => ({
    userId: r.userId,
    userName: r.user.name,
    nodeId: r.skillNodeId,
    nodeTitle: r.skillNode.title,
    skillName: r.skill.name,
    createdAt: r.updatedAt.toISOString(),
  }));
}

export async function listAdminSkills(tenantId: string) {
  const db = getTenantDb(tenantId);
  return db.skill.findMany({
    where: { tenantId },
    include: { nodes: { orderBy: { y: 'asc' } } },
    orderBy: { name: 'asc' },
  });
}

export type SkillNodeInput = {
  title: string;
  description?: string;
  x: number;
  y: number;
  requiredScore: number;
  courseId?: string | null;
  prerequisiteId?: string | null;
};

export type CreateSkillInput = {
  name: string;
  description?: string;
  category: string;
  targetLevel: number;
  nodes: SkillNodeInput[];
};

export async function createSkill(tenantId: string, input: CreateSkillInput) {
  const db = getTenantDb(tenantId);
  const existing = await db.skill.findFirst({ where: { tenantId, name: input.name } });
  if (existing) throw new DomainError('Já existe uma competência com este nome.', 409);

  return db.skill.create({
    data: {
      tenantId,
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      targetLevel: input.targetLevel,
      nodes: {
        create: input.nodes.map((n) => ({
          tenantId,
          title: n.title,
          description: n.description ?? null,
          x: n.x,
          y: n.y,
          requiredScore: n.requiredScore,
          courseId: n.courseId ?? null,
          prerequisiteId: n.prerequisiteId ?? null,
        })),
      },
    },
    include: { nodes: true },
  });
}