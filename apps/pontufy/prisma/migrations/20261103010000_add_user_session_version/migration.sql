-- ═══════════════════════════════════════════════════════════════════════════
-- V5 · Revogação de sessão sem Redis
--
-- Antes, `revoke-all` incrementava `session-version:<userId>` apenas no Redis.
-- Sem Redis a operação era no-op, e a única forma de cortar o acesso de alguém
-- era esperar os 7 dias do JWT expirarem (ou rotacionar AUTH_SECRET, que
-- derrubava todo mundo).
--
-- Agora a versão vive no banco e é comparada no `getSessionContext`, que já
-- faz uma query para revalidar usuário/tenant — custo zero adicional.
-- O Redis continua como caminho rápido para o modo single-device.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1;
