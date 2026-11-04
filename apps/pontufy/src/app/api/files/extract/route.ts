import { NextResponse } from 'next/server';
import { getSessionContext } from '@/backend/session';
import { reserveUploadQuota } from '@/infra/upload-quota';
import { logger } from '@/infra/logger';

// ═══════════════════════════════════════════════════════════════════════════
// Extração de texto de arquivos enviados (V6)
//
// Antes: validava apenas a EXTENSÃO, aceitava qualquer quantidade de arquivos,
// declarava 10 MB como limite (acima dos 4,5 MB que a Vercel aceita — número
// decorativo) e rodava `pdf-parse`/`mammoth` em memória sem timeout.
//
// Agora: o tipo é conferido pelo conteúdo (magic bytes), a requisição tem
// orçamento de arquivos e bytes, e cada parse tem prazo. Um PDF malformado ou
// um lote abusivo não consome a função inteira.
// ═══════════════════════════════════════════════════════════════════════════

/** Alinhado ao limite de corpo da Vercel (~4,5 MB); o valor anterior nunca era atingido. */
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 5;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 20_000;

type SupportedKind = 'pdf' | 'docx' | 'text' | 'media';

interface FormatRule {
  kind: SupportedKind;
  /** Assinaturas aceitas (magic bytes em hex). Vazio = texto, validado por conteúdo. */
  signatures: string[];
  extensions: string[];
}

const FORMATS: FormatRule[] = [
  { kind: 'pdf', signatures: ['25504446'], extensions: ['pdf'] }, // %PDF
  { kind: 'docx', signatures: ['504b0304', '504b0506'], extensions: ['docx', 'xlsx', 'pptx'] }, // ZIP
  { kind: 'media', signatures: ['66747970'], extensions: ['mp4'] }, // ....ftyp
  { kind: 'media', signatures: ['494433'], extensions: ['mp3'] }, // ID3
  { kind: 'media', signatures: ['52494646'], extensions: ['wav'] }, // RIFF
  { kind: 'media', signatures: ['1a45dfa3'], extensions: ['webm'] }, // EBML
  { kind: 'text', signatures: [], extensions: ['txt', 'md', 'csv'] },
];

/** Lê os primeiros bytes do arquivo para conferir a assinatura real. */
async function readMagic(file: File, bytes = 8): Promise<string> {
  const buffer = await file.slice(0, bytes).arrayBuffer();
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Valida que o conteúdo corresponde à extensão declarada.
 * Retorna o tipo suportado ou `null` quando o arquivo não é o que diz ser.
 */
async function detectKind(file: File, extension: string): Promise<SupportedKind | null> {
  const rule = FORMATS.find((format) => format.extensions.includes(extension));
  if (!rule) return null;

  if (rule.kind === 'text') {
    // Texto não tem assinatura: exige UTF-8 decodificável e sem bytes nulos.
    const sample = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    if (sample.some((byte) => byte === 0)) return null;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample);
    } catch {
      return null;
    }
    return 'text';
  }

  const magic = await readMagic(file);
  const matches = rule.signatures.some((signature) => magic.startsWith(signature));
  return matches ? rule.kind : null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Tempo limite de leitura excedido (${label})`)), ms),
    ),
  ]);
}

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let tenantId: string;
  try {
    const context = await getSessionContext();
    tenantId = context.tenantId;
  } catch {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }

  const formData = await request.formData();
  const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
  }

  if (files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Envie no máximo ${MAX_FILES_PER_REQUEST} arquivos por requisição.`, code: 'TOO_MANY_FILES' },
      { status: 413 },
    );
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: `O lote excede ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB. Envie menos arquivos por vez.`,
        code: 'PAYLOAD_TOO_LARGE',
      },
      { status: 413 },
    );
  }

  // V6 (parte 2) — quota diária por tenant. O limite por lote não impede
  // repetição; a reserva acontece ANTES do parse e é contabilizada mesmo que
  // o arquivo falhe depois (é o custo de CPU que se está limitando).
  const quota = await reserveUploadQuota(tenantId, files.length, totalBytes);
  if (!quota.allowed) {
    const isFiles = quota.reason === 'files';
    return NextResponse.json(
      {
        error: isFiles
          ? `Limite diário de ${quota.limit} arquivos atingido para esta empresa. Tente novamente amanhã.`
          : `Limite diário de ${Math.round(quota.limit / 1024 / 1024)} MB de upload atingido para esta empresa.`,
        code: 'UPLOAD_QUOTA_EXCEEDED',
        used: quota.used,
        limit: quota.limit,
      },
      { status: 429 },
    );
  }

  const results: { name: string; text: string; extracted: boolean; reason?: string }[] = [];

  for (const file of files) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

    if (file.size === 0) {
      results.push({ name: file.name, text: '', extracted: false, reason: 'empty' });
      continue;
    }

    if (file.size > MAX_FILE_SIZE) {
      results.push({
        name: file.name,
        text: '',
        extracted: false,
        reason: `arquivo acima de ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB`,
      });
      continue;
    }

    let kind: SupportedKind | null = null;
    try {
      kind = await detectKind(file, extension);
    } catch (error) {
      logger.warn('Falha ao inspecionar arquivo', { tenantId, error: String(error) }, 'files');
    }

    if (!kind) {
      // Conteúdo não corresponde à extensão: recusa sem tentar parsear.
      results.push({
        name: file.name,
        text: '',
        extracted: false,
        reason: 'tipo de arquivo não reconhecido para esta extensão',
      });
      continue;
    }

    try {
      const text = await withTimeout(extractText(file, kind), PARSE_TIMEOUT_MS, file.name);
      results.push({ name: file.name, text, extracted: text.length > 0 });
    } catch (error) {
      logger.warn('Falha ao extrair texto', { tenantId, file: file.name, error: String(error) }, 'files');
      results.push({ name: file.name, text: '', extracted: false, reason: 'falha na extração' });
    }
  }

  return NextResponse.json({ results });
}

async function extractText(file: File, kind: SupportedKind): Promise<string> {
  switch (kind) {
    case 'text':
      return await file.text();

    case 'pdf':
      return await extractPdf(file);

    case 'docx':
      return await extractDocx(file);

    case 'media':
      return `[Mídia: ${file.name} — transcrição não disponível, usar como material de apoio]`;

    default:
      return '';
  }
}

async function extractPdf(file: File): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const data = new Uint8Array(await file.arrayBuffer());
  const parser = new PDFParse({ data } as never);
  const result = (await parser.getText()) as { text?: string };
  return (result.text ?? '').slice(0, 50_000);
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await mammoth.extractRawText({ buffer });
  return result.value.slice(0, 50_000);
}
