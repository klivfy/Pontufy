-- ═══════════════════════════════════════════════════════════════════════════
-- A3 · JSON nativo
--
-- `Course.quizJson` e `Battle.questionsJson` eram TEXT com JSON serializado à
-- mão. Passam a `jsonb`: o banco valida a forma, os leitores deixam de fazer
-- `JSON.parse` dentro de try/catch e a validação de contrato fica em Zod
-- (schemas/quiz.ts).
--
-- Conversão defensiva: linha com JSON inválido não pode derrubar a migração em
-- produção. O `CASE` isola esses casos — `quizJson` vira NULL e `questionsJson`
-- (NOT NULL) vira um objeto vazio, que o leitor trata como "sem questões".
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "Course"
  ALTER COLUMN "quizJson" TYPE jsonb
  USING (
    CASE
      WHEN "quizJson" IS NULL OR btrim("quizJson") = '' THEN NULL
      WHEN btrim("quizJson") ~ '^[\[{]' THEN "quizJson"::jsonb
      ELSE NULL
    END
  );

ALTER TABLE "Battle"
  ALTER COLUMN "questionsJson" TYPE jsonb
  USING (
    CASE
      WHEN btrim("questionsJson") ~ '^[\[{]' THEN "questionsJson"::jsonb
      ELSE '{"questions":[]}'::jsonb
    END
  );
