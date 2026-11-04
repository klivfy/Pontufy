import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// Kit de aula — os quatro formatos que o motor entrega por aula
//
// O curso deixa de ser "um markdown" e passa a ser um kit: slides para projetar,
// roteiro de vídeo para assistir, texto em linguagem simples para ler rápido e
// um checkpoint curto para fixar. O markdown continua existindo como leitura
// longa — ele não foi substituído, foi cercado.
//
// Toda leitura é TOLERANTE: `readLessonKit` devolve null em vez de lançar, e o
// chamador deriva o kit do markdown quando não há nada gravado. Um JSON antigo,
// um campo truncado por limite de token ou um modelo que devolveu lixo não
// podem derrubar a tela do colaborador.
// ═══════════════════════════════════════════════════════════════════════════

export const slideSchema = z.object({
  title: z.string().min(3),
  bullets: z.array(z.string().min(2)).min(1).max(6),
  notes: z.string().optional(),
  visual: z.string().optional(),
});

export const videoSceneSchema = z.object({
  /** o que o instrutor fala (vira narração TTS) */
  narration: z.string().min(20),
  /** texto grande na tela — precisa caber em uma linha */
  onScreen: z.string().min(2).max(120),
  /** descrição do apoio visual (imagem, animação, gráfico) */
  visual: z.string().min(2).max(240),
  /** duração da cena em segundos */
  seconds: z.number().int().min(5).max(60),
});

export const lessonVideoSchema = z.object({
  title: z.string().min(3),
  scenes: z.array(videoSceneSchema).min(2).max(10),
  /**
   * MP4 renderizado por um provedor de vídeo (Wan/LTX/CogVideoX).
   *
   * Fica FORA do schema de geração: o modelo nunca inventa uma URL. Quem
   * preenche é o `video-engine`, depois do render; quando ausente, o player
   * executa o roteiro narrado. É o mesmo kit, com ou sem mídia.
   */
  videoUrl: z.string().url().optional(),
  /** Provedor que renderizou — usado só para telemetria/custo. */
  videoProvider: z.string().optional(),
});

export const glossaryEntrySchema = z.object({
  term: z.string().min(2).max(60),
  definition: z.string().min(10).max(280),
});

export const plainTextSchema = z.object({
  /** resumo em linguagem simples — o "leia em 40 segundos" */
  summary: z.string().min(40),
  /** pontos-chave, uma linha cada */
  bullets: z.array(z.string().min(5)).min(2).max(8),
  glossary: z.array(glossaryEntrySchema).max(8).optional(),
});

export const checkpointQuestionSchema = z.object({
  question: z.string().min(10),
  options: z.array(z.string().min(1)).min(2).max(5),
  correctIndex: z.number().int().min(0).max(4),
  explanation: z.string().optional(),
  difficulty: z.enum(['facil', 'medio', 'dificil']).optional(),
});

export const lessonKitSchema = z.object({
  video: lessonVideoSchema,
  slides: z.array(slideSchema).min(1).max(12),
  plain: plainTextSchema,
  checkpoint: z.array(checkpointQuestionSchema).max(4),
});

export type Slide = z.infer<typeof slideSchema>;
export type VideoScene = z.infer<typeof videoSceneSchema>;
export type LessonVideo = z.infer<typeof lessonVideoSchema>;
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;
export type PlainText = z.infer<typeof plainTextSchema>;
export type CheckpointQuestion = z.infer<typeof checkpointQuestionSchema>;
export type LessonKit = z.infer<typeof lessonKitSchema>;

/**
 * Lê um kit de qualquer JSON persistido.
 *
 * Estratégia: valida o mínimo indispensável (vídeo com cenas, slides, resumo) e
 * descarta o resto. Um kit parcial é melhor que nenhum — a aba que não tiver
 * conteúdo simplesmente some na interface.
 */
export function readLessonKit(value: unknown): LessonKit | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;

  const video = lessonVideoSchema.safeParse(candidate.video);
  const plain = plainTextSchema.safeParse(candidate.plain);
  if (!video.success || !plain.success) return null;

  const slides = z
    .array(slideSchema)
    .safeParse(Array.isArray(candidate.slides) ? candidate.slides : []);
  const checkpoint = z
    .array(checkpointQuestionSchema)
    .safeParse(Array.isArray(candidate.checkpoint) ? candidate.checkpoint : []);

  return {
    video: video.data,
    plain: plain.data,
    slides: slides.success ? slides.data : [],
    checkpoint: checkpoint.success ? checkpoint.data : [],
  };
}

/** Kit utilizável: tem pelo menos uma cena e um slide. */
export function isKitUsable(kit: LessonKit | null | undefined): kit is LessonKit {
  return !!kit && kit.video.scenes.length > 0 && kit.slides.length > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Variantes ESTRITAS — só para o structured output
//
// Provedores com json_schema estrito (Groq) exigem TODA propriedade em
// `required`: `.optional()` e `.default()` geram campo fora de required e o
// request é rejeitado com 400 antes do modelo rodar. Por isso aqui não existe
// nada opcional — campo sem conteúdo vem como string vazia ou array vazio.
// ═══════════════════════════════════════════════════════════════════════════

export const strictSlideSchema = z.object({
  title: z.string().min(3).describe('Título curto do slide'),
  bullets: z.array(z.string().min(2)).min(1).max(6).describe('2 a 5 marcadores curtos'),
  notes: z.string().describe('O que o instrutor fala neste slide; vazio se não houver'),
  visual: z.string().describe('Apoio visual sugerido; vazio se não houver'),
});

export const strictVideoSceneSchema = z.object({
  narration: z.string().min(20).describe('Fala do instrutor na cena, em linguagem falada'),
  onScreen: z.string().min(2).max(120).describe('Texto grande exibido na tela'),
  visual: z.string().min(2).max(240).describe('Imagem/animação que acompanha a cena'),
  seconds: z.number().int().min(5).max(60).describe('Duração da cena em segundos'),
});

export const strictLessonVideoSchema = z.object({
  title: z.string().min(3),
  scenes: z.array(strictVideoSceneSchema).min(3).max(8),
});

export const strictPlainTextSchema = z.object({
  summary: z.string().min(40).describe('Resumo em 3 a 5 frases curtas, linguagem do dia a dia'),
  bullets: z.array(z.string().min(5)).min(3).max(6).describe('Pontos-chave em uma linha cada'),
  glossary: z
    .array(
      z.object({
        term: z.string().min(2).max(60),
        definition: z.string().min(10).max(280),
      }),
    )
    .max(6)
    .describe('Termos técnicos da aula traduzidos; vazio se não houver'),
});

export const strictCheckpointQuestionSchema = z.object({
  question: z.string().min(10),
  options: z.array(z.string().min(1)).min(2).max(5),
  correctIndex: z.number().int().min(0).max(4),
  explanation: z.string().describe('Por que a correta está correta'),
  difficulty: z.enum(['facil', 'medio', 'dificil']),
});

export const lessonKitGenerationSchema = z.object({
  video: strictLessonVideoSchema,
  slides: z.array(strictSlideSchema).min(3).max(6),
  plain: strictPlainTextSchema,
  checkpoint: z.array(strictCheckpointQuestionSchema).min(2).max(3),
});
