import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getSessionContext } from '@/backend/session';
import { prisma, getTenantDb } from '@/backend/db';
import { buildAdoptionReport } from '@/domain/analytics/adoption';

type DailyRow = { day: Date; completions: bigint; points: bigint; redemptions: bigint };
type TopCourseRow = {
  course_id: string;
  course_title: string;
  status: string;
  completions: bigint;
  enrolled_users: bigint;
  points_generated: bigint;
  lesson_count: bigint;
};

export async function GET() {
  try {
    const { tenantId, role } = await getSessionContext();

    if (role !== 'admin_rh' && role !== 'super_admin') {
      return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const db = getTenantDb(tenantId);

    // All scalar metrics aggregated in PostgreSQL — no in-memory accumulation.
    const [totalUsers, activeUsers, totalCompletions, pointsAwarded, pointsRedeemed, coursesCount] =
      await Promise.all([
        db.user.count({ where: { role: { not: 'admin_rh' } } }),
        db.user.count({
          where: {
            role: { not: 'admin_rh' },
            pointsLedger: { some: { timestamp: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
          },
        }),
        db.lessonCompletion.count({ where: { user: { role: { not: 'admin_rh' } } } }),
        db.pointsLedger.aggregate({ _sum: { pointsAmount: true }, where: { type: 'gain' } }),
        db.pointsLedger.aggregate({ _sum: { pointsAmount: true }, where: { type: 'loss' } }),
        db.course.count({}),
      ]);

    // Daily engagement for the last 30 days: COUNT and SUM computed entirely in PostgreSQL.
    // $queryRaw is required because Prisma groupBy does not support DATE_TRUNC.
    // tenantId is injected explicitly here since $queryRaw bypasses the Zero-Trust extension.
    const [engagementRows, topCourseRows, adoption] = await Promise.all([
      prisma.$queryRaw<DailyRow[]>(Prisma.sql`
        SELECT
          COALESCE(c.day, p.day, r.day) AS day,
          COALESCE(c.completions, 0)    AS completions,
          COALESCE(p.points, 0)         AS points,
          COALESCE(r.redemptions, 0)    AS redemptions
        FROM (
          SELECT DATE_TRUNC('day', "createdAt")::date AS day,
                 COUNT(*)                             AS completions
          FROM   "LessonCompletion"
          WHERE  "tenantId"  = ${tenantId}
            AND  "createdAt" >= NOW() - INTERVAL '30 days'
          GROUP  BY DATE_TRUNC('day', "createdAt")::date
        ) c
        FULL OUTER JOIN (
          SELECT DATE_TRUNC('day', "timestamp")::date AS day,
                 SUM("pointsAmount")                  AS points
          FROM   "PointsLedger"
          WHERE  "tenantId"  = ${tenantId}
            AND  "type"      = 'gain'
            AND  "timestamp" >= NOW() - INTERVAL '30 days'
          GROUP  BY DATE_TRUNC('day', "timestamp")::date
        ) p ON c.day = p.day
        FULL OUTER JOIN (
          SELECT DATE_TRUNC('day', "timestamp")::date AS day,
                 COUNT(*)                             AS redemptions
          FROM   "PointsLedger"
          WHERE  "tenantId"  = ${tenantId}
            AND  "type"      = 'loss'
            AND  "timestamp" >= NOW() - INTERVAL '30 days'
          GROUP  BY DATE_TRUNC('day', "timestamp")::date
        ) r ON COALESCE(c.day, p.day) = r.day
        ORDER  BY day ASC
      `),
      prisma.$queryRaw<TopCourseRow[]>(Prisma.sql`
        -- O curso vem de Lesson: "LessonCompletion" NÃO tem courseId.
        -- Referenciar lc."courseId" quebrava com 42703 (coluna não existe) e
        -- derrubava /api/admin/analytics com 500 no painel do RH.
        SELECT l."courseId"                              AS course_id,
               COALESCE(c."title", '(Curso removido)')   AS course_title,
               -- status virou enum (CourseStatus) no A2. Sem o cast, o
               -- Postgres tenta coagir o COALESCE ao enum e rejeita o literal
               -- 'removed' (22P02) — curso removido não tem status.
               COALESCE(c."status"::text, 'removed')     AS status,
               COUNT(*)                                   AS completions,
               COUNT(DISTINCT lc."userId")                AS enrolled_users,
               COALESCE(SUM(l."pointsAssigned"), 0)       AS points_generated,
               COUNT(DISTINCT l."id")                     AS lesson_count
        FROM   "LessonCompletion" lc
        LEFT   JOIN "Lesson" l ON lc."lessonId" = l.id
        LEFT   JOIN "Course" c ON l."courseId" = c.id
        WHERE  lc."tenantId" = ${tenantId}
        GROUP  BY l."courseId", c."title", c."status"
        ORDER  BY completions DESC
        LIMIT   10
      `),
      // O funil de adoção consulta o mesmo banco por SQL próprio: "concluiu um
      // curso" depende de comparar conclusões com o total de aulas do curso,
      // e isso o Prisma não expressa em groupBy.
      buildAdoptionReport(tenantId),
    ]);

    // Only date formatting happens in Node.js — the aggregation is already done.
    const engagement = engagementRows.map((r) => ({
      date: new Date(r.day).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      completions: Number(r.completions),
      points: Number(r.points),
      redemptions: Number(r.redemptions),
    }));

    const topCourses = topCourseRows.map((r) => ({
      id: r.course_id,
      title: r.course_title,
      status: r.status,
      completions: Number(r.completions),
      enrolledUsers: Number(r.enrolled_users),
      pointsGenerated: Number(r.points_generated),
      lessonCount: Number(r.lesson_count),
    }));

    return NextResponse.json({
      summary: {
        totalUsers,
        activeUsers,
        totalCompletions,
        totalPointsAwarded: pointsAwarded._sum.pointsAmount ?? 0,
        totalPointsRedeemed: pointsRedeemed._sum.pointsAmount ?? 0,
        totalCourses: coursesCount,
      },
      engagement,
      topCourses,
      adoption,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Não autenticado.') {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    console.error('GET /api/admin/analytics:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}