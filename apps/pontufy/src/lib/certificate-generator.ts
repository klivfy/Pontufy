import { jsPDF } from 'jspdf';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Gerador do certificado corporativo Pontufy (A4 paisagem, 297 x 210 mm).
// Estética MD3: md-primary #10B981, md-tertiary, md-highlight #f7d0a9.
// Assinatura criptográfica (HMAC-SHA256) para verificação imutável. Server-only.

export interface CertificateData {
  employeeName: string;
  courseName: string;
  tenantName: string;
  completionDate: string; // já formatado em pt-BR
  workloadHours: number;
  lessonCount: number;
  verificationHash: string; // UUID único impresso no rodapé
  signature: string; // HMAC-SHA256 hex
}

const PAGE_W = 297;
const PAGE_H = 210;

// MD3 tokens (conforme design system collaborator app)
const MD_PRIMARY: [number, number, number] = [16, 185, 129];      // #10B981
const MD_TERTIARY: [number, number, number] = [139, 92, 246];     // #8B5CF6
const MD_HIGHLIGHT: [number, number, number] = [247, 208, 169];   // #F7D0A9
const WHITE: [number, number, number] = [255, 255, 255];
const GRAY_400: [number, number, number] = [161, 161, 161];
const GRAY_600: [number, number, number] = [115, 115, 115];
const BG_DARK: [number, number, number] = [18, 18, 18];

export function generateCertificatePdf(data: CertificateData): Buffer<ArrayBuffer> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Fundo dark MD3
  doc.setFillColor(BG_DARK[0], BG_DARK[1], BG_DARK[2]);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Moldura principal md-primary
  doc.setDrawColor(MD_PRIMARY[0], MD_PRIMARY[1], MD_PRIMARY[2]);
  doc.setLineWidth(2);
  doc.rect(8, 8, PAGE_W - 16, PAGE_H - 16);

  // Moldura interna md-tertiary
  doc.setDrawColor(MD_TERTIARY[0], MD_TERTIARY[1], MD_TERTIARY[2]);
  doc.setLineWidth(0.5);
  doc.rect(12, 12, PAGE_W - 24, PAGE_H - 24);

  // Cabeçalho: empresa
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(GRAY_400[0], GRAY_400[1], GRAY_400[2]);
  doc.text(data.tenantName.toUpperCase(), PAGE_W / 2, 32, { align: 'center' });

  // Linha decorativa md-highlight
  doc.setDrawColor(MD_HIGHLIGHT[0], MD_HIGHLIGHT[1], MD_HIGHLIGHT[2]);
  doc.setLineWidth(1.5);
  doc.line(90, 36, 207, 36);

  // Título principal
  doc.setFontSize(36);
  doc.setTextColor(MD_PRIMARY[0], MD_PRIMARY[1], MD_PRIMARY[2]);
  doc.text('CERTIFICADO', PAGE_W / 2, 58, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(GRAY_400[0], GRAY_400[1], GRAY_400[2]);
  doc.text('DE CONCLUSÃO', PAGE_W / 2, 68, { align: 'center' });

  // Divisor md-tertiary
  doc.setDrawColor(MD_TERTIARY[0], MD_TERTIARY[1], MD_TERTIARY[2]);
  doc.setLineWidth(0.8);
  doc.line(90, 76, 207, 76);

  // Corpo: "Certificamos que"
  doc.setFontSize(12);
  doc.setTextColor(GRAY_400[0], GRAY_400[1], GRAY_400[2]);
  doc.text('Certificamos que', PAGE_W / 2, 94, { align: 'center' });

  // Nome do colaborador (destaque branco)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(WHITE[0], WHITE[1], WHITE[2]);
  doc.text(doc.splitTextToSize(data.employeeName, 230), PAGE_W / 2, 110, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(GRAY_400[0], GRAY_400[1], GRAY_400[2]);
  doc.text('concluiu com sucesso o curso', PAGE_W / 2, 122, { align: 'center' });

  // Nome do curso (md-primary)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(MD_PRIMARY[0], MD_PRIMARY[1], MD_PRIMARY[2]);
  doc.text(doc.splitTextToSize(data.courseName, 220), PAGE_W / 2, 136, { align: 'center' });

  // Detalhes
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(GRAY_400[0], GRAY_400[1], GRAY_400[2]);
  doc.text(
    `Carga horária: ${data.workloadHours} hora${data.workloadHours === 1 ? '' : 's'}  ·  ${data.lessonCount} aula${data.lessonCount === 1 ? '' : 's'}`,
    PAGE_W / 2,
    150,
    { align: 'center' },
  );
  doc.text(`Concluído em ${data.completionDate}`, PAGE_W / 2, 160, { align: 'center' });

  // Assinaturas com linhas md-highlight
  doc.setDrawColor(MD_HIGHLIGHT[0], MD_HIGHLIGHT[1], MD_HIGHLIGHT[2]);
  doc.setLineWidth(0.5);
  doc.line(55, 180, 135, 180);
  doc.line(162, 180, 242, 180);

  doc.setFontSize(9);
  doc.setTextColor(GRAY_600[0], GRAY_600[1], GRAY_600[2]);
  doc.text(doc.splitTextToSize(data.tenantName, 80), 95, 187, { align: 'center' });
  doc.text('Pontufy Platform', 202, 187, { align: 'center' });

  // Badge de raridade baseado no hash (determinístico)
  const rarity = getRarityFromHash(data.verificationHash);
  const rarityLabel = rarity === 'legendary' ? 'LENDÁRIO' : rarity === 'epic' ? 'ÉPICO' : rarity === 'rare' ? 'RARO' : 'COMUM';
  const rarityColor = rarity === 'legendary' ? MD_HIGHLIGHT : rarity === 'epic' ? MD_TERTIARY : rarity === 'rare' ? MD_PRIMARY : GRAY_400;

  doc.setDrawColor(rarityColor[0], rarityColor[1], rarityColor[2]);
  doc.setLineWidth(0.8);
  doc.roundedRect(PAGE_W / 2 - 25, 170, 50, 10, 2, 2, 'D');
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(rarityColor[0], rarityColor[1], rarityColor[2]);
  doc.text(rarityLabel, PAGE_W / 2, 177, { align: 'center' });

  // Código de verificação + assinatura criptográfica
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(GRAY_600[0], GRAY_600[1], GRAY_600[2]);
  doc.text(`Verificação: ${data.verificationHash.slice(0, 8)}…`, PAGE_W / 2, 195, { align: 'center' });
  doc.text(`Assinatura: ${data.signature.slice(0, 16)}…`, PAGE_W / 2, 200, { align: 'center' });

  return Buffer.from(doc.output('arraybuffer'));
}

function getRarityFromHash(hash: string): 'common' | 'rare' | 'epic' | 'legendary' {
  const sum = hash.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const mod = sum % 100;
  if (mod < 2) return 'legendary';   // 2%
  if (mod < 8) return 'epic';         // 6%
  if (mod < 23) return 'rare';        // 15%
  return 'common';                    // 77%
}

// ── Assinatura do certificado ────────────────────────────────────────────────
// Payload canônico: JSON com CHAVES ORDENADAS. O `join('|')` anterior colidia
// quando um campo continha o separador (employeeName "A|B" + courseName "C" vs
// employeeName "A" + courseName "B|C" produziam o mesmo HMAC) e não sobrevivia
// a renomeações de campo.
export const CERTIFICATE_PAYLOAD_VERSION = 2;

export function buildCertificatePayload(data: Omit<CertificateData, 'signature'>): string {
  return JSON.stringify({
    v: CERTIFICATE_PAYLOAD_VERSION,
    courseName: data.courseName,
    completionDate: data.completionDate,
    employeeName: data.employeeName,
    lessonCount: data.lessonCount,
    tenantName: data.tenantName,
    verificationHash: data.verificationHash,
    workloadHours: data.workloadHours,
  });
}

function resolveVerificationSecret(): string {
  const secret = process.env.CERTIFICATE_VERIFICATION_SECRET;

  if (secret && secret.length >= 32) return secret;

  // Fail-closed: sem segredo forte, produção não assina certificado nenhum.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[SECURITY] CERTIFICATE_VERIFICATION_SECRET ausente ou com menos de 32 caracteres. ' +
        'Certificados não podem ser assinados com segredo default/previsível.',
    );
  }

  // Desenvolvimento local: derivado do AUTH_SECRET para não existir segredo
  // constante no código. Nunca é usado em produção (o throw acima impede).
  return `dev-only-${process.env.AUTH_SECRET ?? 'local'}-certificate-secret`;
}

// Assinatura HMAC-SHA256 determinística sobre o payload canônico.
export function signPayload(payload: string): string {
  return createHmac('sha256', resolveVerificationSecret()).update(payload).digest('hex');
}

export function computeCertificateSignature(data: Omit<CertificateData, 'signature'>): string {
  return signPayload(buildCertificatePayload(data));
}

// Verifica a assinatura de um payload já persistido (verificação pública).
// O payload gravado é a string exata que foi assinada — nunca reconstruída
// com defaults, que era a causa de todo certificado legítimo parecer inválido.
export function verifyPayload(payload: string, signature: string): boolean {
  if (!payload || !signature) return false;

  const expected = signPayload(payload);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(signature, 'utf8');

  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

// Verifica a assinatura a partir dos dados (usado em testes/emissão).
export function verifyCertificateSignature(data: CertificateData): boolean {
  if (!data.signature) return false;
  return verifyPayload(buildCertificatePayload(data), data.signature);
}