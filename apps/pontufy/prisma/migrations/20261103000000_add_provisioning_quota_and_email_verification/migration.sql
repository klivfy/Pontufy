-- ═══════════════════════════════════════════════════════════════════════════
-- V3 · Provisionamento de tenant com verificação de e-mail + cota diária
--
-- Antes existiam três caminhos para criar Tenant, e só o formulário público
-- tinha limite. Qualquer e-mail Google desconhecido criava empresa, trial e
-- 20 créditos de IA (custo real de LLM), sem verificação e sem teto.
--
-- Agora o tenant do formulário nasce em `pending_verification` com
-- `aiCredits = 0`; os créditos e o login são liberados por EmailVerification.
-- ProvisioningQuota é o kill switch diário (tenants e créditos de IA).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerification_token_key" ON "EmailVerification"("token");
CREATE INDEX "EmailVerification_email_idx" ON "EmailVerification"("email");
CREATE INDEX "EmailVerification_tenantId_idx" ON "EmailVerification"("tenantId");

ALTER TABLE "EmailVerification"
  ADD CONSTRAINT "EmailVerification_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailVerification"
  ADD CONSTRAINT "EmailVerification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProvisioningQuota" (
    "day" TEXT NOT NULL,
    "tenants" INTEGER NOT NULL DEFAULT 0,
    "aiCredits" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProvisioningQuota_pkey" PRIMARY KEY ("day")
);
