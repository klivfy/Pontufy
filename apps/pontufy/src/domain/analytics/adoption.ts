import { Prisma } from '@prisma/client';

import { getRawPrisma } from '@/infra/platform-db';

// ═══════════════════════════════════════════════════════════════════════════
// Adoção — o funil completo
//
// O painel existente responde "quanto a empresa consumiu": conclusões, pontos,
// resgates. Não responde a pergunta que decide renovação de contrato: **quanta
// gente da base chegou a usar isto, e onde as pessoas param**.
//
// Quatro degraus, agora que `LessonStart` existe:
//
//   elegível  → todo usuário que não é admin de RH
//   abriu     → abriu ao menos uma aula          (LessonStart)
//   concluiu  → concluiu ao menos uma aula       (LessonCompletion)
//   terminou  → concluiu TODAS as aulas de um curso
//
// Antes eram três, e o mais informativo era invisível: "abriu e não concluiu"
// não existia como número. O funil mostrava 20% de início e escondia a
// diferença entre ninguém ter entrado e todo mundo ter entrado e saído.
//
// LIMITE DECLARADO: `LessonStart` nasceu em 04/11/2026 e **não tem backfill** —
// abertura de aula não era registrada antes disso. A adoção anterior a essa
// data aparece como "não abriu", mesmo que a pessoa tenha concluído aulas. Por
// isso o campo `measuredSince`: sem ele, o primeiro mês leria como regressão.
//
// BASE ELEGÍVEL: todas as contagens excluem `admin_rh`, não só a de elegíveis.
// Descoberto com os dados do tenant de demonstração: as duas únicas conclusões
// eram do admin, que testava o player. Sem o filtro, o funil mostrava "1 pessoa
// começou" numa base de 5 onde ninguém havia começado — e o abandono ficava
// negativo. Quem testa o produto não é usuário do produto.
// ═══════════════════════════════════════════════════════════════════════════

export type AdoptionStageKey = 'eligible' | 'opened' | 'completedOne' | 'completers';

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
  opened: number;
  completedOne: number;
  /** Percentual de quem abriu dentro do departamento (0–100, uma casa). */
  openRate: number;
}

export interface AdoptionReport {
  funnel: AdoptionStage[];
  stages: {
    eligible: number;
    opened: number;
    completedOne: number;
    completers: number;
  };
  /** Abriram a aula e não concluíram nenhuma — o número que faltava. */
  abandoned: number;
  /** `abandoned / opened`, em % (0–100, uma casa). Zero sem aberturas. */
  abandonmentRate: number;
  /** Aulas concluídas por quem concluiu ao menos uma. 0 quando ninguém concluiu. */
  lessonsPerLearner: number;
  /** Aberturas de aula por quem abriu ao menos uma. */
  opensPerLearner: number;
  /** Dias entre criar a conta e concluir a primeira aula. `null` sem dados. */
  medianDaysToFirstLesson: number | null;
  byDepartment: AdoptionDepartment[];
  /** Início da série de `LessonStart` — antes disso "abriu" não existe. */
  measuredSince: string | null;
  blindSpot: string;
}

export interface RawFunnelRow {
  eligible: bigint | number;
  opened: bigint | number;
  completed_one: bigint | number;
  completers: bigint | number;
  completions: bigint | number;
  opens: bigint | number;
}

export interface RawDepartmentRow {
  department: string;
  eligible: bigint | number;
  opened: bigint | number;
  completed_one: bigint | number;
}

const BLIND_SPOT =
  'A abertura de aula passou a ser registrada em 04/11/2026 e não há backfill: ' +
  'conclusão anterior a essa data aparece como "não abriu". Os dois primeiros ' +
  'degraus ficam confiáveis conforme a série avança.';

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
  measuredSince: string | null = null,
): AdoptionReport {
  const eligible = Number(raw.eligible ?? 0);
  const opened = Number(raw.opened ?? 0);
  const completedOne = Number(raw.completed_one ?? 0);
  const completers = Number(raw.completers ?? 0);
  const completions = Number(raw.completions ?? 0);
  const opens = Number(raw.opens ?? 0);

  // Quem abriu e não concluiu nada. Nunca negativo: conclusão sem abertura
  // registrada é dado legado, não abandono.
  const abandoned = Math.max(0, opened - completedOne);

  const median =
    medianDays === null || !Number.isFinite(medianDays) ? null : round1(Math.max(0, medianDays));

  return {
    funnel: [
      {
        key: 'eligible',
        label: 'Elegíveis',
        users: eligible,
        shareOfEligible: eligible > 0 ? 100 : 0,
      },
      {
        key: 'opened',
        label: 'Abriram uma aula',
        users: opened,
        shareOfEligible: pct(opened, eligible),
      },
      {
        key: 'completedOne',
        label: 'Concluíram uma aula',
        users: completedOne,
        shareOfEligible: pct(completedOne, eligible),
      },
      {
        key: 'completers',
        label: 'Concluíram um curso',
        users: completers,
        shareOfEligible: pct(completers, eligible),
      },
    ],
    stages: { eligible, opened, completedOne, completers },
    abandoned,
    abandonmentRate: pct(abandoned, opened),
    lessonsPerLearner: completedOne > 0 ? round1(completions / completedOne) : 0,
    opensPerLearner: opened > 0 ? round1(opens / opened) : 0,
    medianDaysToFirstLesson: median,
    byDepartment: departments
      .map((row) => {
        const deptEligible = Number(row.eligible ?? 0);
        const deptOpened = Number(row.opened ?? 0);
        const deptCompleted = Number(row.completed_one ?? 0);
        return {
          department: row.department,
          eligible: deptEligible,
          opened: deptOpened,
          completedOne: deptCompleted,
          openRate: pct(deptOpened, deptEligible),
        };
      })
      .sort((a, b) => b.eligible - a.eligible || a.department.localeCompare(b.department)),
    measuredSince,
    blindSpot: BLIND_SPOT,
  };
}

/**
 * Consulta o funil do tenant. `$queryRaw` não passa pela extensão de Zero Trust,
 * então o `tenantId` é injetado explicitamente — nunca interpolado em string.
 */
export async function buildAdoptionReport(tenantId: string): Promise<AdoptionReport> {
  const db = getRawPrisma();

  const [funnelRows, departmentRows, medianRows, sinceRows] = await Promise.all([
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
        JOIN   "User" u ON u.id = pc.user_id
        WHERE  pc.done >= cs.lessons
          AND  u.role::text <> 'admin_rh'
      )
      SELECT
        (SELECT COUNT(*) FROM "User" u
          WHERE u."tenantId" = ${tenantId} AND u.role::text <> 'admin_rh')        AS eligible,
        (SELECT COUNT(DISTINCT ls."userId") FROM "LessonStart" ls
          JOIN   "User" u ON u.id = ls."userId"
          WHERE  ls."tenantId" = ${tenantId} AND u.role::text <> 'admin_rh')      AS opened,
        (SELECT COUNT(DISTINCT lc."userId") FROM "LessonCompletion" lc
          JOIN   "User" u ON u.id = lc."userId"
          WHERE  lc."tenantId" = ${tenantId} AND u.role::text <> 'admin_rh')      AS completed_one,
        (SELECT COUNT(*) FROM completers)                                         AS completers,
        (SELECT COUNT(*) FROM "LessonCompletion" lc
          JOIN   "User" u ON u.id = lc."userId"
          WHERE  lc."tenantId" = ${tenantId} AND u.role::text <> 'admin_rh')      AS completions,
        (SELECT COUNT(*) FROM "LessonStart" ls
          JOIN   "User" u ON u.id = ls."userId"
          WHERE  ls."tenantId" = ${tenantId} AND u.role::text <> 'admin_rh')      AS opens
    `),
    db.$queryRaw<RawDepartmentRow[]>(Prisma.sql`
      WITH opened AS (
        SELECT DISTINCT ls."userId" AS user_id
        FROM   "LessonStart" ls
        WHERE  ls."tenantId" = ${tenantId}
      ),
      completed AS (
        SELECT DISTINCT lc."userId" AS user_id
        FROM   "LessonCompletion" lc
        WHERE  lc."tenantId" = ${tenantId}
      )
      SELECT COALESCE(NULLIF(TRIM(u."department"), ''), 'Sem departamento') AS department,
             COUNT(*)                 AS eligible,
             COUNT(o.user_id)         AS opened,
             COUNT(c.user_id)         AS completed_one
      FROM   "User" u
      LEFT   JOIN opened o ON o.user_id = u.id
      LEFT   JOIN completed c ON c.user_id = u.id
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
      WHERE  u."tenantId" = ${tenantId} AND u.role::text <> 'admin_rh'
    `),
    db.$queryRaw<Array<{ first_open: Date | null }>>(Prisma.sql`
      SELECT MIN(ls."createdAt") AS first_open
      FROM   "LessonStart" ls
      WHERE  ls."tenantId" = ${tenantId}
    `),
  ]);

  const funnel = funnelRows[0] ?? {
    eligible: 0,
    opened: 0,
    completed_one: 0,
    completers: 0,
    completions: 0,
    opens: 0,
  };
  const medianRaw = medianRows[0]?.median_days ?? null;
  const firstOpen = sinceRows[0]?.first_open ?? null;

  return shapeAdoption(
    funnel,
    departmentRows,
    medianRaw === null ? null : Number(medianRaw),
    firstOpen ? new Date(firstOpen).toISOString() : null,
  );
}
