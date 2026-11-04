import { NextResponse } from 'next/server';
import { getSessionContext } from '@/backend/session';
import { getTenantDb } from '@/backend/db';
import { buildCsvRow } from '@/lib/csv-sanitizer';

/** Teto de linhas por exportação (V7). */
const MAX_EXPORT_ROWS = 50_000;

export async function GET() {
  try {
    const { tenantId, role } = await getSessionContext();

    if (role !== 'admin_rh') {
      return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const db = getTenantDb(tenantId);

    const courses = await db.course.findMany({
      where: { status: 'published' },
      include: {
        lessons: { select: { id: true, pointsAssigned: true } },
      },
    });

    const allLessonIds = courses.flatMap((c: any) => c.lessons.map((l: any) => l.id));

    const completions = await db.lessonCompletion.findMany({
      where: { lessonId: { in: allLessonIds } },
      select: { lessonId: true, userId: true },
      // V7 — teto de exportação: acima disso a resposta vira 413 com orientação,
      // em vez de carregar a base inteira na memória de uma função serverless.
      take: MAX_EXPORT_ROWS + 1,
    });

    if (completions.length > MAX_EXPORT_ROWS) {
      return NextResponse.json(
        {
          error:
            `Relatório acima do limite de ${MAX_EXPORT_ROWS} conclusões. ` +
            'Filtre por período ou solicite a exportação assíncrona.',
          code: 'EXPORT_TOO_LARGE',
        },
        { status: 413 },
      );
    }

    const completionsByLesson = new Map<string, Set<string>>();
    for (const c of completions) {
      if (!completionsByLesson.has(c.lessonId)) {
        completionsByLesson.set(c.lessonId, new Set());
      }
      completionsByLesson.get(c.lessonId)!.add(c.userId);
    }

    const users = await db.user.findMany({
      where: { role: { not: 'admin_rh' } },
      select: { id: true },
    });
    const totalEmployees = users.length || 1;

    const redemptions = await db.pointsLedger.findMany({
      where: { tenantId, type: 'loss' },
      select: { pointsAmount: true },
    });
    const totalRedeemed = redemptions.reduce((sum, r) => sum + r.pointsAmount, 0);

    const csvRows = [
      ['Curso', 'Total Aulas', 'Completions Totais', 'Taxa Conclusão (%)', 'Pontos Disponíveis'].join(','),
    ];

    for (const course of courses) {
      const lessonIds = (course as any).lessons.map((l: any) => l.id);
      const totalLessons = lessonIds.length;
      const totalPossible = totalLessons * totalEmployees;

      let totalCompletions = 0;
      for (const lid of lessonIds) {
        totalCompletions += completionsByLesson.get(lid)?.size || 0;
      }

      const rate = totalPossible > 0 ? ((totalCompletions / totalPossible) * 100).toFixed(1) : '0.0';
      const totalPoints = (course as any).lessons.reduce((s: number, l: any) => s + l.pointsAssigned, 0);

      csvRows.push(
        buildCsvRow([course.title, totalLessons, totalCompletions, rate, totalPoints]),
      );
    }

    csvRows.push('');
    csvRows.push(`Pontos Resgatados Total,${totalRedeemed}`);
    csvRows.push(`Total Colaboradores,${totalEmployees}`);

    const csvContent = csvRows.join('\n');

    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="relatorio-engajamento-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error: any) {
    if (error.message === 'Não autenticado.') {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    console.error('GET /api/admin/reports/export:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
