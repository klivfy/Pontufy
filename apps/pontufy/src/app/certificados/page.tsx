import { Award, BookOpen } from 'lucide-react';

import { getSessionContext } from '@/infra/session';
import { getTenantDb } from '@/infra/db';
import CertificateBadgeMural, {
  type CertificateWithMeta,
} from '@/components/certificates/CertificateBadgeMural';

// ═══════════════════════════════════════════════════════════════════════════
// C5 — Fronteira RSC: esta página era 100% client e buscava em
// `/api/certificates` no `useEffect`, mostrando spinner antes de qualquer
// conteúdo.
//
// Agora o dado é lido no servidor, com a mesma sessão e o mesmo escopo de
// tenant, e chega no primeiro paint. O cliente continua dono do que é
// interativo (mural, raridade, compartilhar) — o `CertificateBadgeMural`
// segue como client component.
//
// Ganho concreto: uma ida ao servidor a menos, sem spinner, e o erro de sessão
// deixa de ser uma tela vazia em silêncio.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export default async function CertificatesPage() {
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

  // Serialização explícita: Date não atravessa a fronteira RSC sem conversão.
  // `verificationHash` é nullable no banco (certificado legado); o mural espera
  // string. Certificado sem hash não é verificável e não deve aparecer como se
  // fosse — fica com string vazia e o mural trata como "sem verificação".
  const serialized: CertificateWithMeta[] = certificates.map((certificate) => ({
    id: certificate.id,
    courseId: certificate.courseId,
    courseName: certificate.courseName,
    issuedAt: certificate.issuedAt.toISOString(),
    verificationHash: certificate.verificationHash ?? '',
  }));

  return (
    <main className="min-h-screen pb-20 pt-24 bg-md-surface-dim">
      <div className="max-w-5xl mx-auto px-6 md:px-8">
        <header className="mb-8 flex items-center gap-3">
          <Award size={28} className="text-md-primary" />
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">Meus Certificados</h1>
            <p className="text-gray-500 mt-0.5 text-sm">
              Certificados emitidos pelos cursos que você concluiu — cada um com raridade única e
              verificação criptográfica.
            </p>
          </div>
        </header>

        {serialized.length === 0 ? (
          <div className="text-center py-24 bg-black/20 border border-white/10 rounded-2xl">
            <BookOpen size={40} className="mx-auto text-gray-600 mb-4" />
            <p className="text-white font-semibold mb-1">Nenhum certificado ainda</p>
            <p className="text-gray-500 text-sm mb-6">
              Conclua um curso para receber seu certificado com badge de raridade.
            </p>
            <a
              href="/cursos"
              className="inline-block px-5 py-2.5 rounded-full text-sm font-bold text-black bg-md-primary hover:opacity-90 transition"
            >
              Ver cursos disponíveis
            </a>
          </div>
        ) : (
          <CertificateBadgeMural certificates={serialized} />
        )}
      </div>
    </main>
  );
}
