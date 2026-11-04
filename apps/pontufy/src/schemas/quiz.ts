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
  /**
   * Identidade estável da questão dentro do banco.
   *
   * O quiz deixou de ser uma lista fixa: cada tentativa sorteia um subconjunto
   * (domain/learning/quiz-selection.ts). Sem id, "a questão 3" só existe como
   * posição — e a posição muda a cada sorteio. Opcional para dados gravados
   * antes deste campo; a seleção ignora questões sem id.
   */
  id: z.string().min(1).optional(),
  question: z.string().min(1),
  options: z.array(quizOptionSchema).min(2),
  correctIndex: z.number().int().min(0),
  explanation: z.string().optional(),
  /** Usada para montar uma prova equilibrada e progressiva. */
  difficulty: z.enum(['facil', 'medio', 'dificil']).optional(),
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

/** Questão como o modelo devolve, antes da validação. */
export interface GeneratedQuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  difficulty?: 'facil' | 'medio' | 'dificil';
}

/**
 * Converte o quiz do modelo no formato persistível.
 *
 * REGRESSÃO QUE ISTO CORRIGE: `quizModulesSchema.parse` era chamado direto na
 * action. Quando o provedor devolvia quiz vazio — ou uma questão com menos de
 * 2 opções, ou `correctIndex` fora do intervalo — o `parse` lançava, e a
 * geração INTEIRA virava erro de Server Component em produção ("An error
 * occurred in the Server Components render"), sem mensagem útil.
 *
 * Regra: a geração já deu certo nesse ponto. Perder o quiz é ruim; perder o
 * curso é pior. Questão inválida é DESCARTADA (com o motivo no retorno) e, se
 * nenhuma sobrar, o curso é gravado sem quiz — o mesmo comportamento que
 * existia antes do A3, agora com validação de verdade.
 */
export function buildQuizModules(
  questions: GeneratedQuizQuestion[] | undefined,
  moduleName = 'Avaliação do Curso',
  makeId: (index: number) => string = (index) => `q${index + 1}`,
): { modules: QuizModule[] | null; discarded: string[] } {
  const discarded: string[] = [];
  const valid: QuizModule['questions'] = [];

  for (const [index, question] of (questions ?? []).entries()) {
    const candidate = {
      id: makeId(index),
      question: question.question,
      options: question.options.map((text) => ({ text })),
      correctIndex: question.correctIndex,
      ...(question.explanation ? { explanation: question.explanation } : {}),
      ...(question.difficulty ? { difficulty: question.difficulty } : {}),
    };

    const parsed = quizQuestionSchema.safeParse(candidate);
    if (!parsed.success) {
      discarded.push(`questão ${index + 1}: ${parsed.error.issues[0]?.message ?? 'inválida'}`);
      continue;
    }
    if (parsed.data.correctIndex >= parsed.data.options.length) {
      discarded.push(`questão ${index + 1}: correctIndex fora do intervalo`);
      continue;
    }
    valid.push(parsed.data);
  }

  if (valid.length === 0) return { modules: null, discarded };

  return { modules: [{ module: moduleName, questions: valid }], discarded };
}

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
