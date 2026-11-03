import { randomUUID } from 'node:crypto';
import { getTenantDb } from '@/backend/db';
import {
  buildCertificatePayload,
  computeCertificateSignature,
  generateCertificatePdf,
} from './certificate-generator';
import { resolveBaseUrl } from '@/lib/email';

// Serviço compartilhado de emissão de certificados (usado por
// POST /api/certificates e POST /api/certificates/generate).
// Zero Trust: tenantId/userId vêm estritamente da sessão; todo acesso passa
// pelo interceptor getTenantDb. Deduplicação garantida por @@unique([userId, courseId]).

export class CertificateError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface IssueCertificateResult {
  buffer: Buffer<ArrayBuffer>;
  filename: string;
}

export async function issueCertificate(
  tenantId: string,
  userId: string,
  courseId: string,
): Promise<IssueCertificateResult> {
  const db = getTenantDb(tenantId);

  const course = await db.course.findFirst({
    where: { id: courseId, status: 'published' },
    include: { lessons: { select: { id: true, title: true } } },
  });
  if (!course) throw new CertificateError('Curso não encontrado.', 404);

  const lessonIds = course.lessons.map((l) => l.id);

  // 100% das aulas precisam de LessonCompletion registrada.
  const completions = await db.lessonCompletion.findMany({
    where: { userId, lessonId: { in: lessonIds } },
    select: { lessonId: true, createdAt: true },
  });
  if (completions.length < lessonIds.length) {
    throw new CertificateError(
      `Curso não concluído. ${completions.length}/${lessonIds.length} aulas completas.`,
      400,
    );
  }

  // Quiz final aprovado (>= 70%, gravado server-side). Curso sem quizJson não exige quiz.
  if (course.quizJson) {
    const passedAttempt = await db.quizAttempt.findFirst({
      where: { userId, courseId, passed: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!passedAttempt) {
      throw new CertificateError('O quiz final ainda não foi aprovado (nota mínima de 70%).', 400);
    }
  }

  const user = await db.user.findFirst({ where: { id: userId }, select: { name: true, email: true } });
  const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { name: true } });
  if (!user || !tenant) {
    throw new CertificateError('Dados do usuário não encontrados.', 404);
  }

  const lastCompletion = completions.reduce((latest, c) =>
    c.createdAt > latest.createdAt ? c : latest,
  );
  const completionDate = lastCompletion.createdAt.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const workloadHours = course.workloadHours > 0 ? course.workloadHours : Math.max(1, lessonIds.length);

  // Hash estável entre reemissões: reutiliza o existente quando o certificado já existe.
  const existing = await db.issuedCertificate.findFirst({
    where: { userId, courseId },
    select: { verificationHash: true, signature: true },
  });
  const verificationHash = existing?.verificationHash ?? randomUUID();

  // Prepara dados para assinatura
  const certData = {
    employeeName: user.name,
    courseName: course.title,
    tenantName: tenant.name,
    completionDate,
    workloadHours,
    lessonCount: lessonIds.length,
    verificationHash,
  };
  // Guardamos a string canônica exata: a verificação pública recalcula o HMAC
  // sobre ela em vez de reconstruir os dados (fonte do bug de "sempre inválido").
  const signedPayload = buildCertificatePayload(certData);
  const signature = computeCertificateSignature(certData);

  const certificate = await db.issuedCertificate.upsert({
    where: { userId_courseId: { userId, courseId } },
    update: {
      courseName: course.title,
      issuedAt: new Date(),
      verificationHash,
      signature,
      signedPayload,
    },
    create: {
      userId,
      tenantId,
      courseId,
      courseName: course.title,
      verificationHash,
      signature,
      signedPayload,
    },
  });

  const buffer = generateCertificatePdf({
    ...certData,
    signature,
  });

  // Envia email com certificado anexado (fire-and-forget)
  const baseUrl = resolveBaseUrl();
  const verifyUrl = `${baseUrl}/verify/${certificate.id}`;
  sendCertificateEmail(user.name, tenant.name, course.title, completionDate, verifyUrl, buffer, user.email).catch(() => {});

  return {
    buffer,
    filename: `certificado-${course.title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.pdf`,
  };
}

async function sendCertificateEmail(
  employeeName: string,
  tenantName: string,
  courseName: string,
  completionDate: string,
  verifyUrl: string,
  pdfBuffer: Buffer<ArrayBuffer>,
  toEmail: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[DEV] Certificate email to ${toEmail}: ${courseName}`);
    return;
  }

  const base64Pdf = Buffer.from(pdfBuffer).toString('base64');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Pontufy <noreply@pontufy.com>',
      to: toEmail,
      subject: `🏆 Seu certificado: ${courseName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #10b981;">Pontufy</h2>
          <p>Parabéns, <strong>${employeeName}</strong>!</p>
          <p>Você concluiu o curso <strong>${courseName}</strong> na <strong>${tenantName}</strong>.</p>
          <p>Data de conclusão: ${completionDate}</p>
          <p>Seu certificado em PDF está anexado a este email.</p>
          <p>Você também pode verificar a autenticidade online:</p>
          <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
            Verificar certificado
          </a>
          <p style="color: #666; font-size: 12px; margin-top: 24px;">Equipe Pontufy</p>
        </div>
      `,
      attachments: [
        {
          filename: `certificado-${courseName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.pdf`,
          content: base64Pdf,
        },
      ],
    }),
  });
}