import { NextResponse } from 'next/server';
import { getSessionContext } from '@/backend/session';
import { getTenantDb } from '@/backend/db';
import { issueCertificate, CertificateError } from '@/domain/certificates';
import { logAudit } from '@/lib/audit';
import { notifyCertificateReady } from '@/lib/notifications';

export async function GET() {
  try {
    const { userId, tenantId } = await getSessionContext();
    const db = getTenantDb(tenantId);

    const certificates = await db.issuedCertificate.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
      select: {
        id: true,
        courseId: true,
        courseName: true,
        issuedAt: true,
        verificationHash: true,
      },
    });

    return NextResponse.json(certificates);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Não autenticado.') {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    console.error('GET /api/certificates:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { tenantId, userId } = await getSessionContext();
    const { courseId } = await request.json();

    if (!courseId || typeof courseId !== 'string') {
      return NextResponse.json({ error: 'courseId é obrigatório.' }, { status: 400 });
    }

    const { buffer, filename } = await issueCertificate(tenantId, userId, courseId);

    // Notificação de certificado pronto (fire-and-forget)
    const course = await getTenantDb(tenantId).course.findFirst({
      where: { id: courseId },
      select: { title: true },
    });
    if (course) {
      notifyCertificateReady({
        tenantId,
        userId,
        courseName: course.title,
      });
    }

    // Trilha de auditoria append-only (nunca derruba a resposta).
    logAudit({
      tenantId,
      userId,
      action: 'CERTIFICATE_ISSUED',
      entity: 'Course',
      entityId: courseId,
      newValue: { courseId, filename },
    });

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Não autenticado.') {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof CertificateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('POST /api/certificates:', error);
    return NextResponse.json({ error: 'Erro interno ao gerar certificado.' }, { status: 500 });
  }
}