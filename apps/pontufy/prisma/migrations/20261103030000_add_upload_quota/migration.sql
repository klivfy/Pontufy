-- ═══════════════════════════════════════════════════════════════════════════
-- Quota diária de upload por tenant (V6, parte 2)
--
-- /api/files/extract limita 5 arquivos e 12 MB POR REQUISIÇÃO. Sem uma medida
-- de consumo, o mesmo cliente repete a chamada indefinidamente — com custo de
-- memória/CPU no parser (pdf-parse, mammoth).
--
-- Esta tabela mede arquivos e bytes por tenant por dia (UTC), do mesmo jeito
-- que ProvisioningQuota mede provisionamento: no banco, funcionando sem Redis.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "UploadQuota" (
    "tenantId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "files" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadQuota_pkey" PRIMARY KEY ("tenantId","day")
);

CREATE INDEX "UploadQuota_day_idx" ON "UploadQuota"("day");

ALTER TABLE "UploadQuota"
  ADD CONSTRAINT "UploadQuota_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
