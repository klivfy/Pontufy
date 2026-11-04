// ═══════════════════════════════════════════════════════════════════════════
// Escritor de ZIP mínimo — sem dependência externa.
//
// Por que não usar `jszip`/`archiver`: o pacote SCORM é um ZIP com uma dúzia de
// arquivos de texto. Puxar uma biblioteca dessas para isso significa mais
// superfície de supply chain num caminho que já mostrou custo (o SDK do Sentry
// arrastou `vite` e `postcss` com advisory alto e reprovou o gate de audit).
//
// Formato: STORE (método 0, sem compressão). O conteúdo é HTML/XML de texto
// curto — compressão economizaria alguns KB e custaria mais código e mais
// chance de erro. Um ZIP válido é um ZIP válido.
//
// Estrutura produzida:
//   [arquivo local]*  [diretório central]*  [EOCD]
//
// Referência: PKWARE APPNOTE 6.3.6, seções 4.3.7 (local), 4.3.12 (central) e
// 4.3.16 (EOCD).
// ═══════════════════════════════════════════════════════════════════════════

import { Buffer } from 'node:buffer';

export interface ZipEntry {
  /** Caminho dentro do pacote, sempre com `/` e sem começar com `/`. */
  name: string;
  content: string | Uint8Array;
}

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Versão 2.0: suficiente para STORE e diretório central básico. */
const VERSION = 20;

let crcTableCache: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (crcTableCache) return crcTableCache;

  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }

  crcTableCache = table;
  return table;
}

/** CRC-32 (polinômio 0xEDB88320), o que o ZIP exige em cada entrada. */
export function crc32(bytes: Uint8Array): number {
  const table = crcTable();
  let crc = 0xffffffff;

  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Data/hora no formato MS-DOS (2 s de resolução, ano a partir de 1980).
 *
 * Fixa por padrão para o pacote ser determinístico: dois exports do mesmo curso
 * geram bytes idênticos, o que torna teste e cache triviais.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - 1980) << 9) | (month << 5) | day,
  };
}

export interface CreateZipOptions {
  /** Data de modificação das entradas. Padrão: 2026-01-01T00:00:00Z. */
  date?: Date;
}

/**
 * Monta um ZIP STORE a partir das entradas.
 *
 * Nome duplicado é erro de programação, não dado: falha na hora em vez de
 * gerar um pacote com duas entradas de mesmo caminho (que alguns LMS leem
 * de forma imprevisível).
 */
export function createZip(entries: ZipEntry[], options: CreateZipOptions = {}): Buffer {
  if (entries.length === 0) {
    throw new Error('ZIP sem entradas: um pacote vazio não é um pacote SCORM válido.');
  }

  const stamp = dosDateTime(options.date ?? new Date(Date.UTC(2026, 0, 1)));
  const seen = new Set<string>();

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = entry.name.replace(/^\/+/, '');

    if (name.length === 0 || name.includes('..')) {
      throw new Error(`Nome de entrada inválido no pacote: "${entry.name}".`);
    }
    if (seen.has(name)) {
      throw new Error(`Entrada duplicada no pacote: "${name}".`);
    }
    seen.add(name);

    const nameBytes = Buffer.from(name, 'utf8');
    const data =
      typeof entry.content === 'string' ? Buffer.from(entry.content, 'utf8') : Buffer.from(entry.content);
    const checksum = crc32(data);

    // ── Cabeçalho local ────────────────────────────────────────────────────
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(0x0800, 6); // flag: nomes em UTF-8
    local.writeUInt16LE(0, 8); // método: STORE
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18); // comprimido == original
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field vazio

    const localRecord = Buffer.concat([local, nameBytes, data]);
    locals.push(localRecord);

    // ── Diretório central ──────────────────────────────────────────────────
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    central.writeUInt16LE(VERSION, 4); // versão que criou
    central.writeUInt16LE(VERSION, 6); // versão necessária
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comentário
    central.writeUInt16LE(0, 34); // disco inicial
    central.writeUInt16LE(0, 36); // atributos internos
    central.writeUInt32LE(0, 38); // atributos externos
    central.writeUInt32LE(offset, 42); // deslocamento do cabeçalho local

    centrals.push(Buffer.concat([central, nameBytes]));

    offset += localRecord.length;
  }

  const centralDirectory = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // número deste disco
  eocd.writeUInt16LE(0, 6); // disco do diretório central
  eocd.writeUInt16LE(entries.length, 8); // entradas neste disco
  eocd.writeUInt16LE(entries.length, 10); // total de entradas
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16); // onde o diretório central começa
  eocd.writeUInt16LE(0, 20); // sem comentário

  return Buffer.concat([...locals, centralDirectory, eocd]);
}

/** Lista os nomes das entradas lendo o diretório central — usado nos testes. */
export function listZipEntries(buffer: Buffer): string[] {
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset < 0) throw new Error('EOCD não encontrado: não é um ZIP.');

  const total = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);
  const names: string[] = [];

  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_HEADER_SIG) {
      throw new Error(`Cabeçalho central inválido na entrada ${i}.`);
    }
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);

    names.push(buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return names;
}
