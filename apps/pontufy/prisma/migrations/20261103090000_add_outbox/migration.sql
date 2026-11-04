-- ═══════════════════════════════════════════════════════════════════════════
-- B3 · Outbox de eventos
--
-- Substitui fire-and-forget por "grava + worker processa". O evento entra na
-- MESMA transação do fato que o originou; se o provedor cair, a tentativa é
-- refeita com backoff em vez de o efeito desaparecer.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'processing', 'done', 'failed');

CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");
CREATE INDEX "OutboxEvent_tenantId_idx" ON "OutboxEvent"("tenantId");
