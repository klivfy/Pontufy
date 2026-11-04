import { Prisma } from '@prisma/client';

import { getRawPrisma } from '@/infra/platform-db';

// ═══════════════════════════════════════════════════════════════════════════
// Adoção — o funil que o painel de engajamento não mostrava
//
// O painel existente responde "quanto a empresa consumiu": conclusões, pontos,
// resgates. Não responde a pergunta que decide renovação de contrato: **quanta
// gente da base chegou a usar isto**.
//
// O funil possível hoje tem três degraus, porque `LessonCompletion` é o único
// evento de aprendizagem que existe (unique por usuário+aula):
//
//   elegível  → todo usuário que não é admin de RH
//   começou   → concluiu ao menos uma aula
//   terminou  → concluiu TODAS as aulas de ao menos um curso
//
// Limite honesto: **não sabemos quem abriu e desistiu**. O player não registra
// "iniciou". Por isso `startRate` é conservador — ele subestima o começo. Criar
// o evento é mudança de schema, não de consulta; está declarado no retorno para
// ninguém ler o número como se fosse a conversão real do primeiro clique.
// ═══════════════════════════════════════════════════════════════════════════

export type AdoptionStageKey = 'eligible' | 'started' | 'completers';

export interface AdoptionStage {
  key: AdoptionStageKey;
  label: string;
  users: number;
  /** Percentual sobre a base elegível (0–100, uma casa). */
  shareOfEligible: number;
}

export interface AdoptionDepartment {
  department: string;
  eligible: number;
  started: number;
  /** Percentual de quem começou dentro do departamento (0–100, uma casa). */
  startRate: number;
}

export interface AdoptionReport {
  funnel: AdoptionStage[];
  stages: {
    eligible: number;
    started: number;
    completers: number;
  };
  /** Aulas concluídas por quem começou. 0 quando ninguém começou. */
  lessonsPerLearner: number;
  /** Dias entre criar a conta e concluir a primeira aula. `null` sem dados. */
  medianDaysToFirstLesson: number | null;
  byDepartment: AdoptionDepartment[];
  blindSpot: string;
}

export interface RawFunnelRow {
  eligible: bigint | number;
  started: bigint | number;
  completers: bigint | number;
  completions: bigint | number;
}

export interface RawDepartmentRow {
  department: string;
  eligible: bigint | number;
  started: bigint | number;
}

const BLIND_SPOT =
  'O player não registra "aula iniciada": quem abriu e desistiu não aparece em ' +
  'nenhuma etapa. "Começou" significa concluiu ao menos uma aula, então a taxa ' +
  'de início é um piso, não a conversão real.';

function pct(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Monta o relatório a partir das linhas cruas. Função pura — é ela que o teste
 * unitário exercita, sem banco.
 */
export function shapeAdoption(
  raw: RawFunnelRow,
  departments: RawDepartmentRow[],
  medianDays: number | null,
): AdoptionReport {
  const eligible = Number(raw.eligible ?? 0);
  const started = Number(raw.started ?? 0);
  const completers = Number(raw.completers ?? 0);
  const completions = Number(raw.completions ?? 0);

  const lessonsPerLearner = started > 0 ? round1(completions / started) : 0;

  // Importação legada pode ter conclusão anterior à criação da conta: número
  // negativo aqui não é dado, é artefato. Piso em zero.
  const median =
    medianDays === null || !Number.isFinite(medianDays)
      ? null
      : round1(Math.max(0, medianDays));

  return {
    funnel: [
      { key: 'eligible', label: 'Elegíveis', users: eligible, shareOfEligible: eligible > 0 ? 100 : 0 },
      { key: 'started', label: 'Começaram', users: started, shareOfEligible: pct(started, eligible) },
      {
        key: 'completers',
        label: 'Concluíram um curso',
        users: completers,
        shareOfEligible: pct(completers, eligible),
      },
    ],
    stages: { eligible, started, completers },
    lessonsPerLearner,
    medianDaysToFirstLesson: median,
    byDepartment: departments
      .map((row) => {
        const deptEligible = Number(row.eligible ?? 0);
        const deptStarted = Number(row.started ?? 0);
        return {
          department: row.department,
          eligible: deptEligible,
          started: deptStarted,
          startRate: pct(deptStarted, deptEligible),
        };
      })
      .sort((a, b) => b.eligible - a.eligible || a.department.localeCompare(b.department)),
    blindSpot: BLIND_SPOT,
  };
}

/**
 * Consulta o funil do tenant. `$queryRaw` não passa pela extensão de Zero Trust,
 * então o `tenantId` é injetado explicitamente — nunca interpolado em string.
 */
export async function buildAdoptionReport(tenantId: string): Promise<AdoptionReport> {
  const db = getRawPrisma();

  const [funnelRows, departmentRows, medianRows] = await Promise.all([
    db.$queryRaw<RawFunnelRow[]>(Prisma.sql`
      WITH course_sizes AS (
        SELECT l."courseId" AS course_id, COUNT(*) AS lessons
        FROM   "Lesson" l
        JOIN   "Course" c ON c.id = l."courseId"
        WHERE  c."tenantId" = ${tenantId}
        GROUP  BY l."courseId"
      ),
      per_course AS (
        SELECT lc."userId" AS user_id, l."courseId" AS course_id, COUNT(*) AS done
        FROM   "LessonCompletion" lc
        JOIN   "Lesson" l ON l.id = lc."lessonId"
        WHERE  lc."tenantId" = ${tenantId}
        GROUP  BY lc."userId", l."courseId"
      ),
      completers AS (
        SELECT DISTINCT pc.user_id
        FROM   per_course pc
        JOIN   course_sizes cs ON cs.course_id = pc.course_id
        WHERE  pc.done >= cs.lessons
      )
      SELECT
        (SELECT COUNT(*) FROM "User" u
          WHERE u."tenantId" = ${tenantId} AND u.role::text <> 'admin_rh')        AS eligible,
        (SELECT COUNT(DISTINCT lc."userId") FROM "LessonCompletion" lc
          WHERE lc."tenantId" = ${tenantId})                                      AS started,
        (SELECT COUNT(*) FROM completers)                                         AS completers,
        (SELECT COUNT(*) FROM "LessonCompletion" lc
          WHERE lc."tenantId" = ${tenantId})                                      AS completions
    `),
    db.$queryRaw<RawDepartmentRow[]>(Prisma.sql`
      WITH started AS (
        SELECT DISTINCT lc."userId" AS user_id
        FROM   "LessonCompletion" lc
        WHERE  lc."tenantId" = ${tenantId}
      )
      SELECT COALESCE(NULLIF(TRIM(u."department"), ''), 'Sem departamento') AS department,
             COUNT(*)                 AS eligible,
             COUNT(s.user_id)         AS started
      FROM   "User" u
      LEFT   JOIN started s ON s.user_id = u.id
      WHERE  u."tenantId" = ${tenantId} AND u.role::text <> 'admin_rh'
      GROUP  BY 1
    `),
    db.$queryRaw<Array<{ median_days: number | null }>>(Prisma.sql`
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (f."firstAt" - u."createdAt")) / 86400.0
             ) AS median_days
      FROM   "User" u
      JOIN (
        SELECT lc."userId" AS user_id, MIN(lc."createdAt") AS "firstAt"
        FROM   "LessonCompletion" lc
        WHERE  lc."tenantId" = ${tenantId}
        GROUP  BY lc."userId"
      ) f ON f.user_id = u.id
      WHERE  u."tenantId" = ${tenantId}
    `),
  ]);

  const funnel = funnelRows[0] ?? { eligible: 0, started: 0, completers: 0, completions: 0 };
  const medianRaw = medianRows[0]?.median_days ?? null;

  return shapeAdoption(
    funnel,
    departmentRows,
    medianRaw === null ? null : Number(medianRaw),
  );
}
