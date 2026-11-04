-- ═══════════════════════════════════════════════════════════════════════════
-- A2 · Enums de domínio (parte 1)
--
-- `Course.status` e `PointsLedger.type` eram strings livres. Um typo
-- ('publised') sumia com o curso da listagem sem erro em lugar nenhum; um
-- `type` desconhecido no ledger quebrava a soma do saldo em silêncio.
--
-- Normalização ANTES da conversão: valor fora do domínio não pode derrubar a
-- migração em produção. O que não é reconhecido vira o padrão conservador
-- (`draft` para curso, `gain` para ledger) e isso fica registrado aqui.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE "CourseStatus" AS ENUM ('draft', 'published');
CREATE TYPE "LedgerType" AS ENUM ('gain', 'loss', 'expiration');

UPDATE "Course" SET "status" = 'draft' WHERE "status" IS NULL OR "status" NOT IN ('draft', 'published');
UPDATE "PointsLedger" SET "type" = 'gain' WHERE "type" IS NULL OR "type" NOT IN ('gain', 'loss', 'expiration');

ALTER TABLE "Course" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Course" ALTER COLUMN "status" TYPE "CourseStatus" USING ("status"::"CourseStatus");
ALTER TABLE "Course" ALTER COLUMN "status" SET DEFAULT 'draft'::"CourseStatus";

ALTER TABLE "PointsLedger" ALTER COLUMN "type" TYPE "LedgerType" USING ("type"::"LedgerType");
