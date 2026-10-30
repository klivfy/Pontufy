import { getTenantDb } from '@/infra/db';
import { getRedis } from '@/infra/redis';

// ═══════════════════════════════════════════════════════════════════════════
// TAREFA 11 — Streaks & engajamento (duráveis, sem migration)
// O histórico de LessonCompletion já é a fonte de verdade: streak = dias
// consecutivos com ≥1 aula concluída. Redis acelera a leitura; a recomputação
// sob demanda garante consistência mesmo após cache vacilante.
// ═══════════════════════════════════════════════════════════════════════════

export interface StreakInfo {
  current: number;      // dias consecutivos até ontem/hoje
  best: number;         // maior sequência histórica
  lastActivityAt: string | null;
  atRisk: boolean;      // streak em risco (atividade hoje, ainda não feita)
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);
}

function normalizeTimezone(date: Date): Date {
  // Comparações por dia devem ser no fuso do servidor; datas do Prisma vêm UTC.
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return startOfDay(local);
}

export async function getStreak(userId: string, tenantId: string): Promise<StreakInfo> {
  const redis = getRedis();
  const cacheKey = `streak:${tenantId}:${userId}`;

  if (redis) {
    const cached = await redis.get<StreakInfo>(cacheKey);
    if (cached && cached.lastActivityAt) {
      // Se a atividade é de hoje, o streak ainda pode crescer — recomputa.
      if (dayDiff(new Date(), new Date(cached.lastActivityAt)) <= 1) {
        return cached;
      }
    }
  }

  const db = getTenantDb(tenantId);
  const days = await db.lessonCompletion.findMany({
    where: { userId },
    select: { createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const daySet = new Set<number>();
  for (const row of days) {
    daySet.add(normalizeTimezone(row.createdAt).getTime());
  }

  const today = normalizeTimezone(new Date()).getTime();
  const yesterday = today - 86_400_000;
  const sorted = [...daySet].sort((a, b) => b - a);

  let current = 0;
  let anchor = daySet.has(today) ? today : daySet.has(yesterday) ? yesterday : null;

  if (anchor !== null) {
    current = 1;
    let cursor = anchor - 86_400_000;
    while (daySet.has(cursor)) {
      current += 1;
      cursor -= 86_400_000;
    }
  }

  // Melhor streak: percorre todos os dias em ordem crescente.
  let best = 0;
  if (sorted.length > 0) {
    const asc = [...daySet].sort((a, b) => a - b);
    let run = 1;
    for (let i = 1; i < asc.length; i++) {
      if (asc[i] - asc[i - 1] === 86_400_000) run += 1;
      else run = 1;
      if (run > best) best = run;
    }
    best = Math.max(best, 1);
  }

  const lastDay = sorted[0] ?? null;
  const info: StreakInfo = {
    current,
    best,
    lastActivityAt: lastDay !== null ? new Date(lastDay).toISOString() : null,
    atRisk: daySet.has(yesterday) && !daySet.has(today) && current > 0,
  };

  if (redis) {
    await redis.set(cacheKey, info, { ex: 86_400 });
  }

  return info;
}

// 11.2 — Multiplicador de burst: 1ª aula do dia = x1, 2ª = x1.5, 3+ = x2.
// Incrementa o contador diário de completions do usuário.
export function burstMultiplier(completionsToday: number): number {
  if (completionsToday >= 3) return 2;
  if (completionsToday === 2) return 1.5;
  return 1;
}

export async function countCompletionsToday(userId: string, tenantId: string): Promise<number> {
  const db = getTenantDb(tenantId);
  const start = normalizeTimezone(new Date());
  const count = await db.lessonCompletion.count({
    where: { userId, createdAt: { gte: start } },
  });
  return count;
}

// 11.4 — Conquistas declarativas, avaliadas sob demanda (sem tabela nova).
export interface Achievement {
  id: string;
  title: string;
  description: string;
  emoji: string;
  test: (stats: { completions: number; streak: number; pointsGained: number }) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_steps', title: 'Primeiros Passos', description: 'Concluiu sua primeira aula.', emoji: '🌱', test: (s) => s.completions >= 1 },
  { id: 'streak_3', title: 'Ritmo Constante', description: '3 dias seguidos de aprendizado.', emoji: '🔥', test: (s) => s.streak >= 3 },
  { id: 'streak_7', title: 'Semana Perfeita', description: '7 dias seguidos de aprendizado.', emoji: '⚡', test: (s) => s.streak >= 7 },
  { id: 'streak_30', title: 'Mês Consistente', description: '30 dias seguidos de aprendizado.', emoji: '🏆', test: (s) => s.streak >= 30 },
  { id: 'ten_lessons', title: 'Dedicação', description: '10 aulas concluídas.', emoji: '📚', test: (s) => s.completions >= 10 },
  { id: 'fifty_lessons', title: 'Máquina de Aprendizado', description: '50 aulas concluídas.', emoji: '🚀', test: (s) => s.completions >= 50 },
  { id: 'hundred_points', title: 'Colecionador', description: 'Acumulou 100 pontos ganhos.', emoji: '💎', test: (s) => s.pointsGained >= 100 },
  { id: 'thousand_points', title: 'Lenda Pontufy', description: 'Acumulou 1.000 pontos ganhos.', emoji: '👑', test: (s) => s.pointsGained >= 1000 },
];

export interface GamificationStats {
  completions: number;
  streak: number;
  pointsGained: number;
}

export async function getUserStats(userId: string, tenantId: string): Promise<GamificationStats> {
  const db = getTenantDb(tenantId);
  const [completions, pointsAgg, streak] = await Promise.all([
    db.lessonCompletion.count({ where: { userId } }),
    db.pointsLedger.aggregate({
      where: { userId, type: 'gain' },
      _sum: { pointsAmount: true },
    }),
    getStreak(userId, tenantId),
  ]);

  return {
    completions,
    streak: streak.current,
    pointsGained: pointsAgg._sum.pointsAmount ?? 0,
  };
}

export async function getUnlockedAchievements(userId: string, tenantId: string): Promise<Achievement[]> {
  const stats = await getUserStats(userId, tenantId);
  return ACHIEVEMENTS.filter((a) => a.test(stats));
}

// ═══════════════════════════════════════════════════════════════════════════
// Níveis de progressão (TAREFA 11 — level up). Base = saldo de pontos.
// ═══════════════════════════════════════════════════════════════════════════

export interface Tier {
  name: string;
  minPoints: number;
  emoji: string;
}

export const TIERS: Tier[] = [
  { name: 'Aprendiz', minPoints: 0, emoji: '🌱' },
  { name: 'Analista', minPoints: 150, emoji: '📘' },
  { name: 'Analista Sénior', minPoints: 350, emoji: '💼' },
  { name: 'Especialista', minPoints: 700, emoji: '⭐' },
  { name: 'Mestre', minPoints: 1200, emoji: '👑' },
];

export function getUserTier(pointsBalance: number): Tier {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (pointsBalance >= t.minPoints) tier = t;
  }
  return tier;
}

export async function getXpLeaderboard(tenantId: string, userId: string) {
  const db = getTenantDb(tenantId);
  const rankingRows = await db.pointsLedger.groupBy({
    by: ['userId'],
    where: { type: 'gain' },
    _sum: { pointsAmount: true },
    orderBy: { _sum: { pointsAmount: 'desc' } },
    take: 10,
  });

  const allRanks = await db.pointsLedger.groupBy({
    by: ['userId'],
    where: { type: 'gain' },
    _sum: { pointsAmount: true },
  });

  const userIds = rankingRows.map((r: { userId: string }) => r.userId);
  const users = userIds.length > 0
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u: { id: string; name: string; email: string }) => [u.id, u]));

  const myTotal = allRanks.find((r: { userId: string; _sum: { pointsAmount: number | null } }) => r.userId === userId)?._sum.pointsAmount ?? 0;
  const myPosition = allRanks.filter((r: { _sum: { pointsAmount: number | null } }) => (r._sum.pointsAmount ?? 0) > myTotal).length + 1;

  const ranking = rankingRows
    .map((row: { userId: string; _sum: { pointsAmount: number | null } }, index: number) => ({
      position: index + 1,
      userId: row.userId,
      name: userMap.get(row.userId)?.name ?? 'Colaborador',
      email: userMap.get(row.userId)?.email ?? '',
      xp: row._sum.pointsAmount ?? 0,
      isMe: row.userId === userId,
    }))
    .filter((r: { xp: number }) => r.xp > 0);

  return {
    ranking,
    myRank: { position: myPosition, xp: myTotal },
  };
}