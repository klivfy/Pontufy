import { prisma } from '@/infra/db';
import { logger } from '@/infra/logger';

// ═══════════════════════════════════════════════════════════════════════════
// Quota diária de upload por tenant (V6, parte 2)
//
// O limite por requisição (5 arquivos / 12 MB) não impede repetição. Esta
// camada mede o consumo do dia por empresa, com reserva ANTES do parse: um
// lote grande que falha no meio já consumiu a cota, e é isso que se quer —
// senão um cliente poderia disparar lotes que estouram memória de graça.
//
// Vive no banco (como ProvisioningQuota) para funcionar sem Redis.
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_MAX_FILES_PER_DAY = 100;
export const DEFAULT_MAX_BYTES_PER_DAY = 100 * 1024 * 1024; // 100 MB

export type UploadQuotaOutcome =
  | { allowed: true; remaining: { files: number; bytes: number } }
  | { allowed: false; reason: 'files' | 'bytes'; limit: number; used: number };

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function maxFilesPerDay(): number {
  return positiveIntFromEnv('UPLOAD_MAX_FILES_PER_DAY', DEFAULT_MAX_FILES_PER_DAY);
}

export function maxBytesPerDay(): number {
  return positiveIntFromEnv('UPLOAD_MAX_BYTES_PER_DAY', DEFAULT_MAX_BYTES_PER_DAY);
}

export function uploadDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Reserva o consumo do lote antes do parse.
 *
 * O incremento é atômico (`upsert` com `increment`), então duas requisições
 * simultâneas do mesmo tenant não passam ambas pelo limite: cada uma
 * incrementa e a que estourar é recusada e tem o incremento revertido.
 */
export async function reserveUploadQuota(
  tenantId: string,
  fileCount: number,
  totalBytes: number,
): Promise<UploadQuotaOutcome> {
  const day = uploadDayKey();
  const filesLimit = maxFilesPerDay();
  const bytesLimit = maxBytesPerDay();

  if (fileCount > filesLimit || totalBytes > bytesLimit) {
    return {
      allowed: false,
      reason: fileCount > filesLimit ? 'files' : 'bytes',
      limit: fileCount > filesLimit ? filesLimit : bytesLimit,
      used: 0,
    };
  }

  try {
    const updated = await prisma.uploadQuota.upsert({
      where: { tenantId_day: { tenantId, day } },
      create: { tenantId, day, files: fileCount, bytes: totalBytes },
      update: {
        files: { increment: fileCount },
        bytes: { increment: totalBytes },
      },
      select: { files: true, bytes: true },
    });

    if (updated.files > filesLimit) {
      await releaseUploadQuota(tenantId, fileCount, totalBytes, day);
      return { allowed: false, reason: 'files', limit: filesLimit, used: updated.files - fileCount };
    }

    if (updated.bytes > bytesLimit) {
      await releaseUploadQuota(tenantId, fileCount, totalBytes, day);
      return { allowed: false, reason: 'bytes', limit: bytesLimit, used: updated.bytes - totalBytes };
    }

    return {
      allowed: true,
      remaining: {
        files: Math.max(0, filesLimit - updated.files),
        bytes: Math.max(0, bytesLimit - updated.bytes),
      },
    };
  } catch (error) {
    // Falha da tabela de quota não pode bloquear o usuário; registra e segue.
    logger.error('Falha ao reservar cota de upload', { tenantId, error: String(error) }, 'files');
    return { allowed: true, remaining: { files: filesLimit, bytes: bytesLimit } };
  }
}

/**
 * Devolve o consumo reservado. Usado quando a reserva estourou o limite e
 * quando o lote não gerou nenhum resultado útil (upload vazio/corrompido).
 */
export async function releaseUploadQuota(
  tenantId: string,
  fileCount: number,
  totalBytes: number,
  day: string = uploadDayKey(),
): Promise<void> {
  try {
    await prisma.uploadQuota.update({
      where: { tenantId_day: { tenantId, day } },
      data: {
        files: { decrement: fileCount },
        bytes: { decrement: totalBytes },
      },
    });
  } catch {
    // Linha pode não existir (falha anterior) — nada a devolver.
  }
}

/** Consumo do dia, para o cabeçalho de resposta e diagnósticos. */
export async function readUploadQuota(tenantId: string): Promise<{ files: number; bytes: number; day: string }> {
  const day = uploadDayKey();
  const row = await prisma.uploadQuota
    .findUnique({ where: { tenantId_day: { tenantId, day } }, select: { files: true, bytes: true } })
    .catch(() => null);

  return { files: row?.files ?? 0, bytes: row?.bytes ?? 0, day };
}
