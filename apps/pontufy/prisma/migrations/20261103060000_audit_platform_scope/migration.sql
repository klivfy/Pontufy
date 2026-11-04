-- ═══════════════════════════════════════════════════════════════════════════
-- B5 · Auditoria com escopo de plataforma
--
-- `AuditLog.tenantId` era NOT NULL, então evento de PLATAFORMA (cron de
-- expiração, provisionamento de tenant, ajuste de crédito de IA pelo
-- super_admin) não tinha onde ser gravado — ou era gravado no tenant errado,
-- poluindo a trilha de um cliente.
--
-- Duas mudanças:
--   1. `tenantId` passa a aceitar NULL (evento genuinamente de plataforma).
--   2. Nasce o tenant `system`, que dá um destino explícito para eventos
--      operacionais e permite consultá-los sem varrer todos os clientes.
--
-- O tenant `system` não é cliente: `contractStatus = 'active'` apenas evita
-- que `isTenantBlocked()` o trate como pendente. Nenhum usuário é criado nele.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "AuditLog" ALTER COLUMN "tenantId" DROP NOT NULL;

INSERT INTO "Tenant" (
  "id", "name", "slug", "sector", "contractStatus", "plan", "aiCredits", "locale", "updatedAt"
)
VALUES (
  'tenant-system', 'Pontufy Platform', 'system', 'tech', 'active', 'enterprise', 0, 'pt-BR', NOW()
)
ON CONFLICT ("id") DO NOTHING;
