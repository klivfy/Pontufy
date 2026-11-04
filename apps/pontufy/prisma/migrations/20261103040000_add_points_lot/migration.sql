-- ═══════════════════════════════════════════════════════════════════════════
-- A1 · Lote de pontos (PointsLot)
--
-- O saldo é um número; o ledger diz que houve ganhos e perdas, mas não quanto
-- de cada ganho ainda está disponível. Sem isso a expiração é heurística e
-- pode expirar o ganho errado.
--
-- Invariante após o backfill: SUM(PointsLot.remaining) == User.pointsBalance.
-- O backfill é feito por `scripts/backfill-points-lots.mjs` (idempotente), não
-- nesta migração: reconstruir a alocação FIFO exige ler o ledger na ordem e
-- não é expressável em SQL declarativo com segurança.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "PointsLot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sourceLedgerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsLot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PointsLot_sourceLedgerId_key" ON "PointsLot"("sourceLedgerId");
CREATE INDEX "PointsLot_userId_expiresAt_idx" ON "PointsLot"("userId", "expiresAt");
CREATE INDEX "PointsLot_expiresAt_remaining_idx" ON "PointsLot"("expiresAt", "remaining");
CREATE INDEX "PointsLot_tenantId_idx" ON "PointsLot"("tenantId");

ALTER TABLE "PointsLot"
  ADD CONSTRAINT "PointsLot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PointsLot"
  ADD CONSTRAINT "PointsLot_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Saldo e consumo de um lote nunca podem ser negativos.
ALTER TABLE "PointsLot"
  ADD CONSTRAINT "PointsLot_amount_nonneg" CHECK ("amount" >= 0),
  ADD CONSTRAINT "PointsLot_remaining_nonneg" CHECK ("remaining" >= 0),
  ADD CONSTRAINT "PointsLot_remaining_within_amount" CHECK ("remaining" <= "amount");
