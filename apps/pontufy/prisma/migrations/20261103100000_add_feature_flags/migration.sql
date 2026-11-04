-- ═══════════════════════════════════════════════════════════════════════════
-- C4 · Feature flags por tenant
--
-- Rollout sem deploy e sem ligar a mudança para todos os clientes de uma vez.
-- Ausência de linha = desabilitado (o call site pode declarar um padrão).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "FeatureFlag" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("tenantId", "key")
);

CREATE INDEX "FeatureFlag_key_idx" ON "FeatureFlag"("key");

ALTER TABLE "FeatureFlag"
  ADD CONSTRAINT "FeatureFlag_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
