-- Kit multi-formato por aula (vídeo, slides, leitura fácil, checkpoint).
--
-- Nullable de propósito: cursos já publicados não têm kit e NÃO serão
-- reescritos por uma migration. O leitor deriva o kit do markdown quando a
-- coluna é NULL (domain/learning/lesson-kit.ts), então o catálogo antigo ganha
-- os formatos novos no dia do deploy, sem backfill e sem risco de sobrescrever
-- conteúdo revisado por humano.

ALTER TABLE "Lesson" ADD COLUMN "blocks" JSONB;
