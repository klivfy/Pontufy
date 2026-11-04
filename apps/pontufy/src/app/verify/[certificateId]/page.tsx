import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { verifyPayload } from '@/lib/certificate-generator';
import { getRawPrisma } from '@/infra/platform-db';
import { enforceIpRateLimit } from '@/infra/security-controls';

// V9 — janela generosa para uso legítimo (RH conferindo vários certificados),
// apertada o suficiente para impedir varredura de ids.
const VERIFY_MAX = 30;
const VERIFY_WINDOW = 10 * 60;

interface Props {
  params: Promise<{ certificateId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { certificateId } = await params;
  return {
    title: `Verificar Certificado | Pontufy`,
    description: `Verifique a autenticidade do certificado ${certificateId} na plataforma Pontufy.`,
    // V9 — a página expõe o nome do colaborador por design (é o propósito da
    // verificação pública), mas não deve ser indexada nem propagar link juice.
    robots: { index: false, follow: false, nocache: true },
    openGraph: {
      title: `Verificar Certificado ${certificateId}`,
      description: 'Verificação de autenticidade de certificado Pontufy',
      type: 'website',
    },
  };
}

export default async function VerifyCertificatePage({ params }: Props) {
  const { certificateId } = await params;

  // V9 — a verificação é pública e expõe o nome do colaborador: sem limite,
  // vira oráculo para enumerar certificados (e custa banco a cada tentativa).
  // Fail-open (decisão D2): sem Redis a verificação continua funcionando.
  const headerBag = await headers();
  const ip = headerBag.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rate = await enforceIpRateLimit(ip, 'verify-certificate', VERIFY_MAX, VERIFY_WINDOW);

  if (rate === 'blocked') {
    return (
      <main className="min-h-screen bg-md-surface-dim flex items-center justify-center p-6">
        <div className="md-card-outlined p-8 max-w-md text-center">
          <h1 className="text-headline-sm font-bold text-md-on-surface mb-2">Muitas consultas</h1>
          <p className="text-body-md text-md-on-surface-variant">
            Aguarde alguns minutos antes de verificar outro certificado. Se você recebeu este
            link de uma empresa, tente novamente mais tarde.
          </p>
        </div>
      </main>
    );
  }

  const prisma = getRawPrisma();

  const certificate = await prisma.issuedCertificate.findUnique({
    where: { id: certificateId },
    include: {
      user: { select: { name: true } },
    },
  });

  const tenant = certificate?.tenantId
    ? await prisma.tenant.findUnique({
        where: { id: certificate.tenantId },
        select: { name: true },
      })
    : null;

  if (!certificate) {
    notFound();
  }

  // Verificação sobre o payload EXATO que foi assinado na emissão.
  // Certificados emitidos antes da correção não têm `signedPayload` e são
  // reportados como "legado" — nunca como fraude.
  const hasVerifiablePayload = Boolean(certificate.signature && certificate.signedPayload);
  const isValid = hasVerifiablePayload
    ? verifyPayload(certificate.signedPayload as string, certificate.signature as string)
    : false;

  const status: 'valid' | 'invalid' | 'legacy' = isValid
    ? 'valid'
    : hasVerifiablePayload
      ? 'invalid'
      : 'legacy';

  const issuedDate = certificate.issuedAt.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <main className="min-h-screen bg-md-surface-dim flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-black/20 border border-md-outline-variant rounded-2xl p-8 md:p-12">
        <div className="text-center mb-8">
          <div className={`inline-flex items-center gap-3 px-6 py-3 rounded-full border ${
            status === 'valid'
              ? 'border-md-tertiary/50 bg-md-tertiary/25 text-md-tertiary'
              : status === 'invalid'
                ? 'border-md-error/50 bg-md-error/25 text-md-error'
                : 'border-md-secondary/50 bg-md-secondary/25 text-md-secondary'
          }`}>
            {status === 'valid' ? (
              <>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="font-bold text-lg">Certificado Válido</span>
              </>
            ) : status === 'invalid' ? (
              <>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="font-bold text-lg">Certificado Inválido</span>
              </>
            ) : (
              <>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" /></svg>
                <span className="font-bold text-lg">Certificado emitido antes da verificação criptográfica</span>
              </>
            )}
          </div>
        </div>

        <div className="bg-black/30 border border-md-outline-variant rounded-xl p-6 space-y-4">
          <div>
            <p className="text-xs text-md-on-surface-variant uppercase tracking-wider">Colaborador</p>
            <p className="text-xl font-bold text-md-on-surface mt-1">{certificate.user?.name || 'Desconhecido'}</p>
          </div>

          <div className="border-t border-md-outline-variant pt-4">
            <p className="text-xs text-md-on-surface-variant uppercase tracking-wider">Curso</p>
            <p className="text-lg font-semibold text-md-primary mt-1">{certificate.courseName}</p>
          </div>

          <div className="border-t border-md-outline-variant pt-4">
            <p className="text-xs text-md-on-surface-variant uppercase tracking-wider">Empresa</p>
            <p className="text-lg text-md-on-surface mt-1">{tenant?.name || 'Desconhecida'}</p>
          </div>

          <div className="border-t border-md-outline-variant pt-4">
            <p className="text-xs text-md-on-surface-variant uppercase tracking-wider">Data de Emissão</p>
            <p className="text-lg text-md-on-surface mt-1">{issuedDate}</p>
          </div>

          <div className="border-t border-md-outline-variant pt-4">
            <p className="text-xs text-md-on-surface-variant uppercase tracking-wider">Código de Verificação</p>
            <p className="font-mono text-sm text-md-on-surface-variant mt-1 break-all">{certificate.verificationHash || 'Não disponível'}</p>
          </div>

          {certificate.signature && (
            <div className="border-t border-md-outline-variant pt-4">
              <p className="text-xs text-md-on-surface-variant uppercase tracking-wider">Assinatura Criptográfica</p>
              <p className="font-mono text-xs text-md-on-surface-variant mt-1 break-all">{certificate.signature.slice(0, 32)}…</p>
            </div>
          )}

          <div className="border-t border-md-outline-variant pt-4 text-center">
            <p className="text-xs text-md-on-surface-variant">
              {status === 'valid'
                ? 'Este certificado foi verificado criptograficamente e é autêntico.'
                : status === 'invalid'
                  ? 'A assinatura deste certificado não confere. O conteúdo pode ter sido alterado.'
                  : 'Este certificado foi emitido antes da assinatura criptográfica entrar em vigor. Os dados acima foram consultados na base da Pontufy.'}
            </p>
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-md-on-surface-variant">
          <p>Pontufy Platform — Verificação pública de certificados</p>
          <p className="mt-1">ID: {certificateId}</p>
        </div>
      </div>
    </main>
  );
}