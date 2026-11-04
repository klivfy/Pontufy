import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// A3 — Contratos de JSON persistido
//
// Antes: `Course.quizJson` e `Battle.questionsJson` eram `String` com JSON
// serializado à mão. Todo leitor fazia `JSON.parse` dentro de try/catch e
// seguia com `[]` quando dava errado — um `correctIndex` inválido passava
// silencioso e a correção do quiz acontecia sobre dado corrompido.
//
// Agora o tipo do banco é `jsonb` e a validação é Zod na escrita (quem grava)
// e na leitura (quem consome). Dado inválido é rejeitado no ponto de entrada,
// não descoberto no cálculo da nota.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Opção de resposta como está persistida: objeto `{ text }`.
 *
 * A forma `{ text }` é a que o player e a correção já consomem; o schema
 * aceita também string crua e normaliza, porque dados antigos podem ter sido
 * gravados das duas maneiras.
 */
export const quizOptionSchema = z.union([
  z.string().min(1).transform((text) => ({ text })),
  z.object({ text: z.string().min(1) }),
]);

/** Questão de quiz de curso (persistida em `Course.quizJson`). */
export const quizQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(quizOptionSchema).min(2),
  correctIndex: z.number().int().min(0),
  explanation: z.string().optional(),
});

export const quizModuleSchema = z.object({
  module: z.string().min(1),
  questions: z.array(quizQuestionSchema).min(1),
});

/** Array de módulos com questões — o formato gravado em `Course.quizJson`. */
export const quizModulesSchema = z
  .array(quizModuleSchema)
  .refine(
    (modules) => modules.every((m) => m.questions.every((q) => q.correctIndex < q.options.length)),
    { message: 'correctIndex fora do intervalo de options' },
  );

export type QuizModule = z.infer<typeof quizModuleSchema>;

/** Questão de duelo (persistida em `Battle.questionsJson`). */
export const battleQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(quizOptionSchema).min(2),
  correctIndex: z.number().int().min(0),
  topic: z.string().optional(),
});

export const battleQuestionsSchema = z
  .object({ questions: z.array(battleQuestionSchema).min(1) })
  .refine(
    (payload) => payload.questions.every((q) => q.correctIndex < q.options.length),
    { message: 'correctIndex fora do intervalo de options' },
  );

export type BattleQuestion = z.infer<typeof battleQuestionSchema>;

/**
 * Leitura tolerante: devolve `[]` para dado ausente ou inválido, mas registra
 * o motivo. Usado em telas (não pode quebrar por causa de uma linha antiga);
 * escrita e correção de nota usam o schema estrito.
 */
export function parseQuizModules(value: unknown): QuizModule[] {
  const parsed = quizModulesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function parseBattleQuestions(value: unknown): BattleQuestion[] {
  const parsed = battleQuestionsSchema.safeParse(value);
  return parsed.success ? parsed.data.questions : [];
}
