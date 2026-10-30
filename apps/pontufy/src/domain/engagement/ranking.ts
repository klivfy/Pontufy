import { getTenantDb } from '@/infra/db';
import { getRedis } from '@/infra/redis';
import { notifyDeptBonusAwarded } from '@/lib/notifications';

function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAREFA 13.2/13.3/13.5 — Ranking interdepartamental semanal
//  • 13.3: Upstash Redis é a fonte de sincronização instantânea — hash
//    `dept-ranking:{tenantId}:{week}` com hincrby a cada ponto registrado.
//  • 13.2: leitura = Redis (tempo real) com fallback agregado no Postgres.
//  • 13.5: bônus coletivo — departamento que atinge 100% da meta semanal de
//    horas estudadas recebe +25 pontos por membro (uma vez por semana).
//    Horas = Σ (workloadHours do curso ÷ nº de aulas) por conclusão.
// ═══════════════════════════════════════════════════════════════════════════

export const DEPT_WEEKLY_HOURS_PER_MEMBER = 2; // meta: 2h estudadas/semana por pessoa
export const DEPT_BONUS_POINTS = 25;

const RANK_KEY = (tenantId: string, week: string) => `dept-ranking:${tenantId}:${week}`;
const HOURS_KEY = (tenantId: string, week: string) => `dept-hours:${tenantId}:${week}`;
const BONUS_KEY = (tenantId: string, week: string) => `dept-bonus:${tenantId}:${week}`;

export interface DeptRankEntry {
  department: string;
  points: number;
  members: number;
  hours: number;
  goalHours: number;
  goalMet: boolean;
  bonusAwarded: boolean;
}

// 13.3 — Soma instantânea de pontos por departamento (chamado a cada ganho).
export async function creditDepartmentPoints(
  tenantId: string,
  department: string | null,
  points: number,
): Promise<void> {
  if (!department) return;
  const redis = getRedis();
  if (!redis) return;
  const week = isoWeekKey(new Date());
  await redis.hincrby(RANK_KEY(tenantId, week), department, points);
  await redis.expire(RANK_KEY(tenantId, week), 14 * 86400);
}

// 13.5 — Acumula horas estudadas (aproximadas por carga horária do curso).
export async function creditDepartmentStudyHours(
  tenantId: string,
  department: string | null,
  hours: number,
): Promise<void> {
  if (!department) return;
  const redis = getRedis();
  if (!redis) return;
  const week = isoWeekKey(new Date());
  const current = Number((await redis.hget<number>(HOURS_KEY(tenantId, week), department)) ?? 0);
  await redis.hset(HOURS_KEY(tenantId, week), { [department]: current + hours });
  await redis.expire(HOURS_KEY(tenantId, week), 14 * 86400);
}

// 13.5 — Bônus coletivo concedido UMA vez por semana por departamento.
export async function awardDepartmentBonusIfGoalMet(
  tenantId: string,
  department: string | null,
): Promise<number> {
  if (!department) return 0;
  const redis = getRedis();
  if (!redis) return 0;

  const week = isoWeekKey(new Date());
  const bonusKey = BONUS_KEY(tenantId, week);

  const already = await redis.hget<number>(bonusKey, department);
  if (already) return 0;

  const db = getTenantDb(tenantId);
  const [members, hours] = await Promise.all([
    db.user.count({ where: { tenantId, department } }),
    redis.hget<number>(HOURS_KEY(tenantId, week), department),
  ]);
  if (members === 0) return 0;

  const goal = members * DEPT_WEEKLY_HOURS_PER_MEMBER;
  if ((hours ?? 0) < goal) return 0;

  await redis.hset(bonusKey, { [department]: 1 });
  await redis.expire(bonusKey, 14 * 86400);

  // +25 pontos para cada membro do departamento (ledger auditável).
  const membersList = await db.user.findMany({
    where: { tenantId, department },
    select: { id: true },
  });

  let credited = 0;
  for (const member of membersList) {
    await db.$transaction([
      db.user.update({
        where: { id: member.id },
        data: { pointsBalance: { increment: DEPT_BONUS_POINTS } },
      }),
      db.pointsLedger.create({
        data: {
          userId: member.id,
          tenantId,
          type: 'gain',
          pointsAmount: DEPT_BONUS_POINTS,
          description: `Bônus coletivo do departamento ${department} (meta semanal atingida)`,
        },
      }),
    ]);
    credited++;
  }

  // Notificar todos os membros do departamento (fire-and-forget)
  for (const member of membersList) {
    notifyDeptBonusAwarded({
      tenantId,
      userId: member.id,
      department,
      bonusPoints: DEPT_BONUS_POINTS,
    });
  }

  return credited;
}

// 13.2 — Ranking semanal: Redis em tempo real + fallback no Postgres.
export async function getDepartmentRanking(tenantId: string): Promise<DeptRankEntry[]> {
  const db = getTenantDb(tenantId);
  const week = isoWeekKey(new Date());
  const redis = getRedis();

  const departments = await db.user.groupBy({
    by: ['department'],
    where: { tenantId, department: { not: null } },
    _count: { _all: true },
  });

  const entries: DeptRankEntry[] = [];

  for (const dept of departments) {
    const name = dept.department as string;
    const members = dept._count._all;
    const goalHours = members * DEPT_WEEKLY_HOURS_PER_MEMBER;

    let points = 0;
    let hours = 0;
    let bonusAwarded = false;

    if (redis) {
      points = Number((await redis.hget<number>(RANK_KEY(tenantId, week), name)) ?? 0);
      hours = Number((await redis.hget<number>(HOURS_KEY(tenantId, week), name)) ?? 0);
      bonusAwarded = Number((await redis.hget<number>(BONUS_KEY(tenantId, week), name)) ?? 0) === 1;
    } else {
      // Fallback: agregação direta no Postgres (sem tempo real).
      // Horas aproximadas: carga do curso ÷ nº de aulas, por conclusão.
      const [pointsAgg, completions] = await Promise.all([
        db.pointsLedger.aggregate({
          where: {
            tenantId,
            type: 'gain',
            timestamp: { gte: weekStart(week) },
            user: { department: name },
          },
          _sum: { pointsAmount: true },
        }),
        db.lessonCompletion.findMany({
          where: {
            tenantId,
            createdAt: { gte: weekStart(week) },
            user: { department: name },
          },
          select: { lesson: { select: { course: { select: { workloadHours: true, lessons: { select: { id: true } } } } } } },
        }),
      ]);
      points = pointsAgg._sum.pointsAmount ?? 0;
      hours = completions.reduce(
        (acc: number, c: any) =>
          acc +
          (c.lesson.course.workloadHours > 0
            ? c.lesson.course.workloadHours / Math.max(1, c.lesson.course.lessons.length)
            : 0),
        0,
      );
    }

    entries.push({
      department: name,
      points,
      members,
      hours,
      goalHours,
      goalMet: hours >= goalHours,
      bonusAwarded,
    });
  }

  return entries.sort((a, b) => b.points - a.points);
}

function weekStart(weekKey: string): Date {
  const [year, week] = weekKey.split('-W').map(Number);
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const days = (week - 1) * 7;
  const monday = new Date(jan1.getTime() + days * 86_400_000);
  // Ajuste para segunda-feira da semana ISO.
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  return monday;
}