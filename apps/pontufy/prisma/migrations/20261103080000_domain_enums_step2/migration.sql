-- ═══════════════════════════════════════════════════════════════════════════
-- A2 · Enums de domínio (parte 2)
--
-- `User.role`, `Tenant.plan` e `Tenant.contractStatus` eram strings livres.
-- Um `role` digitado errado virava usuário sem permissão (ou pior, comparação
-- que nunca casa), e `plan` desconhecido caía no fallback de crédito sem
-- registro.
--
-- `contractStatus` mantém 'cancelled' E 'canceled': a base tem as duas grafias
-- e `isTenantBlocked()` reconhece ambas. Unificar exigiria migração de dados —
-- fica explícito no tipo em vez de virar bug silencioso.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE "Role" AS ENUM ('admin_rh', 'employee', 'super_admin', 'guest');
CREATE TYPE "Plan" AS ENUM ('trial', 'starter', 'enterprise');
CREATE TYPE "ContractStatus" AS ENUM ('active', 'suspended', 'cancelled', 'canceled', 'pending_verification');

-- Normalização defensiva antes da conversão.
UPDATE "User" SET "role" = 'employee' WHERE "role" IS NULL OR "role" NOT IN ('admin_rh', 'employee', 'super_admin', 'guest');
UPDATE "Tenant" SET "plan" = 'trial' WHERE "plan" IS NULL OR "plan" NOT IN ('trial', 'starter', 'enterprise');
UPDATE "Tenant" SET "contractStatus" = 'active' WHERE "contractStatus" IS NULL
  OR "contractStatus" NOT IN ('active', 'suspended', 'cancelled', 'canceled', 'pending_verification');

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'employee'::"Role";

ALTER TABLE "Tenant" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "Tenant" ALTER COLUMN "plan" TYPE "Plan" USING ("plan"::"Plan");
ALTER TABLE "Tenant" ALTER COLUMN "plan" SET DEFAULT 'trial'::"Plan";

ALTER TABLE "Tenant" ALTER COLUMN "contractStatus" DROP DEFAULT;
ALTER TABLE "Tenant" ALTER COLUMN "contractStatus" TYPE "ContractStatus" USING ("contractStatus"::"ContractStatus");
ALTER TABLE "Tenant" ALTER COLUMN "contractStatus" SET DEFAULT 'active'::"ContractStatus";
