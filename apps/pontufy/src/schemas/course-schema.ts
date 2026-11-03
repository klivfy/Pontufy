import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════
// Esquema rígido de conteúdo (anti-alucinação & qualidade mínima)
// ═══════════════════════════════════════════════════════════════════════
// Regras:
//  - Lesson.content: Markdown completo, mínimo de 200 caracteres úteis.
//  - Lesson.pointsAwarded: inteiro positivo entre 10 e 100.
//  - Quiz: question (string), options (3 a 5 strings), correctIndex (0-based).

export const quizSchema = z.object({
  question: z.string().min(10, 'A pergunta deve ter no mínimo 10 caracteres'),
  options: z.array(z.string().min(1)).min(3, 'Mínimo de 3 opções').max(5, 'Máximo de 5 opções'),
  correctIndex: z.number().int().min(0).max(4),
  explanation: z.string().optional(),
});

export const lessonSchema = z.object({
  title: z.string().min(5, 'Título da aula muito curto'),
  content: z
    .string()
    .min(200, 'O conteúdo Markdown da aula deve ter pelo menos 200 caracteres'),
  pointsAwarded: z.number().int().min(10).max(100).default(20),
  order: z.number().int().min(1),
});

export const generatedCourseSchema = z.object({
  title: z.string().min(5, 'Título do curso obrigatório'),
  description: z.string().min(20, 'Descrição detalhada obrigatória'),
  category: z.string().default('Geral'),
  estimatedDurationMinutes: z.number().int().min(5).default(30),
  lessons: z.array(lessonSchema).min(3, 'O curso deve conter pelo menos 3 aulas'),
  quiz: z.array(quizSchema).min(2, 'O curso deve conter pelo menos 2 perguntas de fixação'),
});

export type GeneratedCourse = z.infer<typeof generatedCourseSchema>;
export type GeneratedLesson = z.infer<typeof lessonSchema>;
export type GeneratedQuiz = z.infer<typeof quizSchema>;

// ═══════════════════════════════════════════════════════════════════════
// Variante ESTRITA — usada apenas na chamada ao modelo
// ═══════════════════════════════════════════════════════════════════════
// Provedores com *structured output* estrito (Groq, OpenAI em strict mode)
// exigem que TODA propriedade de `properties` apareça em `required`.
// `.default()` e `.optional()` produzem campos fora de `required` e o request
// é rejeitado com 400 ANTES de o modelo rodar — descoberto na primeira
// execução real contra o Groq:
//
//   invalid JSON schema for response_format:
//   /properties/lessons/items/required: The following properties must be
//   listed in `required`: pointsAwarded
//
// Aqui todo campo é obrigatório; os valores padrão continuam sendo aplicados
// por `generatedCourseSchema.parse()` depois da resposta.
export const strictQuizSchema = z.object({
  question: z.string().min(10, 'A pergunta deve ter no mínimo 10 caracteres'),
  options: z.array(z.string().min(1)).min(3, 'Mínimo de 3 opções').max(5, 'Máximo de 5 opções'),
  correctIndex: z.number().int().min(0).max(4),
  explanation: z.string().describe('Por que a alternativa correta está correta'),
});

export const strictLessonSchema = z.object({
  title: z.string().min(5, 'Título da aula muito curto'),
  content: z
    .string()
    .min(200, 'O conteúdo Markdown da aula deve ter pelo menos 200 caracteres'),
  pointsAwarded: z.number().int().min(10).max(100).describe('Pontos entre 10 e 100'),
  order: z.number().int().min(1),
});

export const courseGenerationSchema = z.object({
  title: z.string().min(5, 'Título do curso obrigatório'),
  description: z.string().min(20, 'Descrição detalhada obrigatória'),
  category: z.string().describe('Categoria do curso, ex.: Compliance'),
  estimatedDurationMinutes: z.number().int().min(5),
  lessons: z.array(strictLessonSchema).min(3, 'O curso deve conter pelo menos 3 aulas'),
  quiz: z.array(strictQuizSchema).min(2, 'O curso deve conter pelo menos 2 perguntas de fixação'),
});
