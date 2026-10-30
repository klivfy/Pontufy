import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { verifyCertificateSignature } from '@/lib/certificate-generator';
import { getRawPrisma } from '@/infra/db';

interface Props {
  params: Promise<{ certificateId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { certificateId } = await params;
  return {
    title: `Verificar Certificado | Pontufy`,
    description: `Verifique a autenticidade do certificado ${certificateId} na plataforma Pontufy.`,
    openGraph: {
      title: `Verificar Certificado ${certificateId}`,
      description: 'Verificação de autenticidade de certificado Pontufy',
      type: 'website',
    },
  };
}

export default async function VerifyCertificatePage({ params }: Props) {
  const { certificateId } = await params;

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

  const isValid = certificate.signature && certificate.verificationHash
    ? verifyCertificateSignature({
        employeeName: certificate.user?.name || '',
        courseName: certificate.courseName,
        tenantName: tenant?.name || '',
        completionDate: certificate.issuedAt.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        }),
        workloadHours: 0,
        lessonCount: 0,
        verificationHash: certificate.verificationHash,
        signature: certificate.signature,
      })
    : false;

  const issuedDate = certificate.issuedAt.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <main className="min-h-screen bg-md-surface-dim flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-black/20 border border-white/10 rounded-2xl p-8 md:p-12">
        <div className="text-center mb-8">
          <div className={`inline-flex items-center gap-3 px-6 py-3 rounded-full border ${
            isValid ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' : 'border-red-500/50 bg-red-500/10 text-red-400'
          }`}>
            {isValid ? (
              <>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="font-bold text-lg">Certificado Válido</span>
              </>
            ) : (
              <>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="font-bold text-lg">Certificado Inválido</span>
              </>
            )}
          </div>
        </div>

        <div className="bg-black/30 border border-white/5 rounded-xl p-6 space-y-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Colaborador</p>
            <p className="text-xl font-bold text-white mt-1">{certificate.user?.name || 'Desconhecido'}</p>
          </div>

          <div className="border-t border-white/10 pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Curso</p>
            <p className="text-lg font-semibold text-md-primary mt-1">{certificate.courseName}</p>
          </div>

          <div className="border-t border-white/10 pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Empresa</p>
            <p className="text-lg text-gray-300 mt-1">{tenant?.name || 'Desconhecida'}</p>
          </div>

          <div className="border-t border-white/10 pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Data de Emissão</p>
            <p className="text-lg text-gray-300 mt-1">{issuedDate}</p>
          </div>

          <div className="border-t border-white/10 pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Código de Verificação</p>
            <p className="font-mono text-sm text-gray-400 mt-1 break-all">{certificate.verificationHash || 'Não disponível'}</p>
          </div>

          {certificate.signature && (
            <div className="border-t border-white/10 pt-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Assinatura Criptográfica</p>
              <p className="font-mono text-xs text-gray-500 mt-1 break-all">{certificate.signature.slice(0, 32)}…</p>
            </div>
          )}

          <div className="border-t border-white/10 pt-4 text-center">
            <p className="text-xs text-gray-500">
              {isValid
                ? 'Este certificado foi verificado criptograficamente e é autêntico.'
                : 'Este certificado não pôde ser verificado. Pode ter sido alterado ou corrompido.'}
            </p>
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Pontufy Platform — Verificação pública de certificados</p>
          <p className="mt-1">ID: {certificateId}</p>
        </div>
      </div>
    </main>
  );
}