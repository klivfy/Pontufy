-- ═══════════════════════════════════════════════════════════════════════════
-- StripeEvent: máquina de estados de idempotência.
--
-- Problema anterior: o registro do evento era criado ANTES do processamento e
-- nunca voltava atrás. Se o processamento falhasse (500), o Stripe reenviava —
-- e o retry caía em `if (existing) return duplicate`, então o evento NUNCA era
-- processado: assinatura paga sem plano/créditos ativados, em silêncio.
--
-- Agora:
--   processing → reivindicado agora (com claim expirando em 60s)
--   processed  → efeitos aplicados; retry é no-op
--   failed     → pode ser reivindicado de novo no próximo retry
--
-- Linhas pré-existentes são marcadas como 'processed': no fluxo antigo elas
-- representavam eventos que ou já tinham sido aplicados, ou estavam bloqueando
-- retries há tempos. Reexecutá-las poderia duplicar efeitos financeiros.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "StripeEvent" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'processing';
ALTER TABLE "StripeEvent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StripeEvent" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "StripeEvent" SET "status" = 'processed';

CREATE INDEX "StripeEvent_status_idx" ON "StripeEvent"("status");
