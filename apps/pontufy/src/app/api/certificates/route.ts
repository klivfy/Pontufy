import { NextResponse } from 'next/server';
import { getSessionContext } from '@/backend/session';
import { getTenantDb } from '@/backend/db';
import { issueCertificate, CertificateError } from '@/domain/certificates';
import { enforceIpRateLimit } from '@/infra/security-controls';
import { logAudit } from '@/lib/audit';
import { notifyCertificateReady } from '@/lib/notifications';

// V9 — emissão limitada por usuário (o "IP" aqui é o id do usuário).
const CERTIFICATE_ISSUE_MAX = 10;
const CERTIFICATE_ISSUE_WINDOW = 10 * 60;

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

    // V9 — emissão limitada por usuário: gerar PDF é caro (jspdf + HMAC) e a
    // operação é idempotente, então não há motivo para aceitar chamadas em
    // série. Política fail-open (D2): sem Redis o certificado é emitido — o
    // endpoint exige sessão e deduplica por @@unique([userId, courseId]).
    const rate = await enforceIpRateLimit(
      `user:${userId}`,
      'certificate-issue',
      CERTIFICATE_ISSUE_MAX,
      CERTIFICATE_ISSUE_WINDOW,
    );
    if (rate === 'blocked') {
      return NextResponse.json(
        { error: 'Muitas emissões seguidas. Aguarde um instante.' },
        { status: 429 },
      );
    }

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