import { test, expect } from '@playwright/test';
import { prisma, SEED } from '../helpers/db';
import { reserveUploadQuota, readUploadQuota, uploadDayKey } from '../../src/infra/upload-quota';

// ═══════════════════════════════════════════════════════════════════════════
// V6 (parte 2) — quota diária de upload por tenant
//
// O limite por requisição (5 arquivos / 12 MB) não impede repetição: o mesmo
// cliente poderia disparar lotes seguidos. Esta camada mede o consumo do dia
// por empresa e recusa quando o teto é atingido.
// ═══════════════════════════════════════════════════════════════════════════

const TENANT = SEED.tenantAlphaId;

async function resetQuota(): Promise<void> {
  await prisma.uploadQuota.deleteMany({ where: { tenantId: TENANT, day: uploadDayKey() } });
}

test.describe('V6 — quota de upload', () => {
  test.beforeEach(resetQuota);
  test.afterAll(resetQuota);

  test('consumo acumula dentro do limite e é recusado ao estourar', async () => {
    const limit = Number(process.env.UPLOAD_MAX_FILES_PER_DAY ?? 100);
    const bytesLimit = Number(process.env.UPLOAD_MAX_BYTES_PER_DAY ?? 100 * 1024 * 1024);

    // Um lote pequeno passa e fica registrado.
    const first = await reserveUploadQuota(TENANT, 2, 1024);
    expect(first.allowed).toBe(true);

    const used = await readUploadQuota(TENANT);
    expect(used.files).toBe(2);
    expect(used.bytes).toBe(1024);

    // Lote maior que o teto de arquivos é recusado sem gravar nada a mais.
    const over = await reserveUploadQuota(TENANT, limit + 1, Math.min(bytesLimit, 1024));
    expect(over.allowed).toBe(false);
    if (!over.allowed) expect(over.reason).toBe('files');

    const after = await readUploadQuota(TENANT);
    expect(after.files, 'recusa não pode consumir cota').toBe(2);
  });

  test('lote que estoura o teto de bytes é recusado e o incremento é revertido', async () => {
    const bytesLimit = Number(process.env.UPLOAD_MAX_BYTES_PER_DAY ?? 100 * 1024 * 1024);

    await reserveUploadQuota(TENANT, 1, 1024);

    const over = await reserveUploadQuota(TENANT, 1, bytesLimit);
    expect(over.allowed).toBe(false);
    if (!over.allowed) expect(over.reason).toBe('bytes');

    const after = await readUploadQuota(TENANT);
    expect(after.bytes, 'reserva recusada precisa ser devolvida').toBe(1024);
    expect(after.files).toBe(1);
  });

  test('requisições simultâneas não ultrapassam o teto de arquivos', async () => {
    const limit = Number(process.env.UPLOAD_MAX_FILES_PER_DAY ?? 100);
    const perRequest = Math.max(1, Math.floor(limit / 4));
    const rounds = Math.ceil((limit * 2) / perRequest);

    const outcomes = await Promise.all(
      Array.from({ length: rounds }, () => reserveUploadQuota(TENANT, perRequest, 1)),
    );

    const allowed = outcomes.filter((o) => o.allowed).length;
    const finalCount = await readUploadQuota(TENANT);

    expect(finalCount.files, 'consumo nunca pode passar do teto').toBeLessThanOrEqual(limit);
    expect(allowed, 'pelo menos um lote precisa ser aceito').toBeGreaterThan(0);
  });
});
