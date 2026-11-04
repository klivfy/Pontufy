import { NextResponse } from 'next/server';

import { getTenantDb } from '@/backend/db';
import { jsonError, requireHrAdmin } from '@/domain/auth';
import { buildScormPackage } from '@/domain/scorm/package';
import { extractRequestMeta, logAudit } from '@/lib/audit';
import { logger } from '@/infra/logger';

// ═══════════════════════════════════════════════════════════════════════════
// Export SCORM 1.2 de um curso
//
// Por que existe: empresa que já tem LMS não compra uma plataforma que sequestra
// o conteúdo. Sem export, o curso morre dentro da Pontufy — e isso pesa na
// decisão de compra de RH grande.
//
// Decisões:
//  • 1.2 e não 2004 — é o que os LMS corporativos aceitam sem configuração.
//  • GET, não POST: é um download, o navegador precisa poder abrir o link
//    direto e o `Content-Disposition` faz o resto.
//  • Exige admin_rh: o pacote leva conteúdo do curso para fora da plataforma.
//  • Auditado: export é saída de propriedade intelectual do cliente.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId, userId } = await requireHrAdmin();
    const { id } = await context.params;

    const db = getTenantDb(tenantId);

    // `findFirst` com escopo do tenant: curso de outra empresa não existe aqui.
    const course = await db.course.findFirst({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        lessons: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, title: true, contentUrl: true, blocks: true },
        },
      },
    });

    if (!course) {
      return NextResponse.json({ error: 'Curso não encontrado.' }, { status: 404 });
    }

    if (course.lessons.length === 0) {
      return NextResponse.json(
        { error: 'Curso sem aulas não pode ser exportado.', code: 'EMPTY_COURSE' },
        { status: 409 },
      );
    }

    const scorm = buildScormPackage(
      { id: course.id, title: course.title, description: course.description },
      course.lessons.map((lesson) => ({
        title: lesson.title,
        // Curso antigo guarda o conteúdo em `contentUrl`; o player usa o mesmo
        // campo como markdown quando não há kit.
        content: lesson.contentUrl ?? '',
        blocks: lesson.blocks,
      })),
    );

    const meta = extractRequestMeta(request);
    await logAudit({
      tenantId,
      userId,
      action: 'COURSE_EXPORTED_SCORM',
      entity: 'Course',
      entityId: course.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newValue: { lessons: scorm.lessonCount, bytes: scorm.buffer.length, format: 'scorm-1.2' },
    });

    logger.info(
      'Curso exportado em SCORM',
      { tenantId, courseId: course.id, lessons: scorm.lessonCount, bytes: scorm.buffer.length },
      'courses',
    );

    return new NextResponse(new Uint8Array(scorm.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${scorm.fileName}"`,
        'Content-Length': String(scorm.buffer.length),
        // Pacote é gerado na hora e leva conteúdo do curso: não guardar em cache.
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) {
      logger.error('GET /api/admin/courses/[id]/scorm', { error: String(error) }, 'courses');
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
