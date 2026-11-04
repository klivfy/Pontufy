-- ═══════════════════════════════════════════════════════════════════════════
-- Saldo de pontos nunca negativo (e ledger sempre não negativo).
--
-- Contexto: `debitPoints` fazia findFirst → compara saldo → update(decrement)
-- dentro de $transaction. Em READ COMMITTED duas requisições concorrentes
-- podiam ler o mesmo saldo, ambas passarem na checagem e ambas decrementarem,
-- levando `User.pointsBalance` a negativo (pontos = passivo financeiro real).
--
-- A defesa principal passou a ser o UPDATE condicional em
-- src/domain/points/index.ts. Esta constraint é a última linha de defesa,
-- válida para qualquer outro caminho que escreva no saldo.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Saneamento do passado: saldos negativos herdados viram zero.
--    (Se houver contexto financeiro a preservar, faça backup antes e revise
--     a lista de usuários afetados — a análise F1.0 lista esses registros.)
UPDATE "User" SET "pointsBalance" = 0 WHERE "pointsBalance" < 0;

-- 2. Constraint adicionada sem lock longo:
--    NOT VALID evita varrer a tabela sob ACCESS EXCLUSIVE;
--    VALIDATE CONSTRAINT depois usa apenas SHARE UPDATE EXCLUSIVE.
ALTER TABLE "User"
  ADD CONSTRAINT "User_pointsBalance_nonneg" CHECK ("pointsBalance" >= 0) NOT VALID;

ALTER TABLE "User" VALIDATE CONSTRAINT "User_pointsBalance_nonneg";

-- 3. Lançamentos do ledger também não podem ser negativos: o valor absoluto
--    fica em `pointsAmount` e o sinal é dado por `type` ('gain' | 'loss').
UPDATE "PointsLedger" SET "pointsAmount" = 0 WHERE "pointsAmount" < 0;

ALTER TABLE "PointsLedger"
  ADD CONSTRAINT "PointsLedger_pointsAmount_nonneg" CHECK ("pointsAmount" >= 0) NOT VALID;

ALTER TABLE "PointsLedger" VALIDATE CONSTRAINT "PointsLedger_pointsAmount_nonneg";
