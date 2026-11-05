-- ═══════════════════════════════════════════════════════════════════════════
-- Aula iniciada — o evento que faltava para medir abandono
--
-- O funil de adoção tinha três degraus: elegível → concluiu uma aula →
-- concluiu um curso. Faltava o primeiro passo real do colaborador, e era
-- justamente ele que respondia "onde as pessoas param".
--
-- `LessonCompletion` só registra quem terminou. Quem abriu e desistiu não
-- aparecia em lugar nenhum — o funil mostrava 20% de início e escondia a
-- diferença entre "ninguém entrou" e "todo mundo entrou e saiu".
--
-- Uma linha por (usuário, aula): interessa a PRIMEIRA abertura. Visita
-- repetida não muda a pergunta e inflaria a tabela sem responder nada novo.
-- `ON CONFLICT DO NOTHING` no recordLessonStart aproveita o índice único.
--
-- Sem backfill: não há dado histórico de abertura para recuperar. O começo da
-- série é a data desta migração, e o funil diz isso (o ponto cego muda de
-- "não medimos" para "medimos a partir de 04/11").
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "LessonStart" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonStart_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LessonStart_userId_lessonId_key" ON "LessonStart"("userId", "lessonId");
CREATE INDEX "LessonStart_tenantId_idx" ON "LessonStart"("tenantId");
CREATE INDEX "LessonStart_userId_idx" ON "LessonStart"("userId");
CREATE INDEX "LessonStart_lessonId_idx" ON "LessonStart"("lessonId");

ALTER TABLE "LessonStart" ADD CONSTRAINT "LessonStart_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonStart" ADD CONSTRAINT "LessonStart_lessonId_fkey"
    FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonStart" ADD CONSTRAINT "LessonStart_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
