-- ═══════════════════════════════════════════════════════════════════════════
-- V7 · Exclusão mútua de jobs em processo
--
-- Os 4 crons podiam rodar sobrepostos (retry da Vercel + cron agendado +
-- disparo manual) e processar o mesmo lote duas vezes: crédito duplicado,
-- desativação duplicada, e-mail repetido.
--
-- Por que TABELA e não pg_advisory_lock: o app conecta por pooler. Advisory
-- lock é por sessão de conexão; com PgBouncer o acquire e o release podem sair
-- em conexões diferentes, e o lock fica preso até o processo morrer. O claim
-- aqui é um INSERT ... ON CONFLICT condicional por TTL — atômico e
-- independente de conexão.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "JobLock" (
    "name" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLock_pkey" PRIMARY KEY ("name")
);

CREATE INDEX "JobLock_expiresAt_idx" ON "JobLock"("expiresAt");
