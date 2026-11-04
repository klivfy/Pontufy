import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getTenantDb } from '@/backend/db';
import { jsonError, requireHrAdmin } from '@/domain/auth';
import { logAudit, extractRequestMeta } from '@/lib/audit';
import { logger } from '@/infra/logger';

// ═══════════════════════════════════════════════════════════════════════════
// IA-5 — Publicação de curso é ato humano
//
// Todo curso gerado por IA nasce `draft`. Antes desta rota, a própria geração
// publicava: o caso encontrado no IA-3 (quiz marcando "escanear pen drive" como
// correto, contra a política "nunca conecte") chegaria ao colaborador sem
// ninguém aprovar.
//
// `unpublish` existe para o caminho inverso: retirar do ar um curso que se
// mostrou inadequado, sem apagar histórico de conclusões.
// ═══════════════════════════════════════════════════════════════════════════

const bodySchema = z.object({
  action: z.enum(['publish', 'unpublish']),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId, userId } = await requireHrAdmin();
    const { id } = await context.params;

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Ação inválida. Use "publish" ou "unpublish".', code: 'INVALID_ACTION' },
        { status: 400 },
      );
    }

    const status = parsed.data.action === 'publish' ? 'published' : 'draft';
    const db = getTenantDb(tenantId);

    // Escopo por tenant no próprio UPDATE: curso de outro tenant não é
    // encontrado, mesmo com id válido.
    const updated = await db.course.updateMany({
      where: { id },
      data: { status },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: 'Curso não encontrado.' }, { status: 404 });
    }

    const course = await db.course.findFirst({
      where: { id },
      select: { id: true, title: true, status: true, lessons: { select: { id: true } } },
    });

    const meta = extractRequestMeta(request);
    await logAudit({
      tenantId,
      userId,
      action: status === 'published' ? 'COURSE_PUBLISHED' : 'COURSE_UNPUBLISHED',
      entity: 'Course',
      entityId: id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newValue: { status, action: parsed.data.action },
    });

    logger.info('Status de curso alterado', { tenantId, courseId: id, status, by: userId }, 'courses');

    return NextResponse.json({
      success: true,
      course: {
        id: course?.id ?? id,
        title: course?.title ?? '',
        status: course?.status ?? status,
        lessonsCount: course?.lessons.length ?? 0,
      },
    });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) {
      logger.error('PATCH /api/admin/courses/[id]/publish', { error: String(error) }, 'courses');
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
