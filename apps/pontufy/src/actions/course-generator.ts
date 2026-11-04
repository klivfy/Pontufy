'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

import { auth } from '@/auth';
import { getTenantDb } from '@/backend/db';
import { rateLimitCheck } from '@/lib/redis';
import { sanitizeAiHtml, sanitizeAiText } from '@/lib/validations/security';
import { logAudit } from '@/lib/audit';
import { logger } from '@/infra/logger';
import { Prisma } from '@prisma/client';
import type { GeneratedCourse } from '@/schemas/course-schema';
import { buildQuizModules } from '@/schemas/quiz';

export type { GeneratedCourse };

// Wrapper de server action — arquivos "use server" só podem exportar
// funções async definidas no próprio módulo (re-export direto é rejeitado).
import { checkAIProviders as checkAIProvidersImpl } from '@/lib/ai-providers';
export async function checkAIProviders(): Promise<{
  available: string[];
  configured: boolean;
  diagnostics: Record<string, string>;
  chainOrder: string[];
}> {
  return checkAIProvidersImpl();
}

// ├────────────── Configuração do modelo de geração ───────────────────

/**
 * Limite de tokens de saída. Convenção AI SDK v6: `maxOutputTokens`
 * (NUNCA `maxTokens` — removido/quebrado no v6).
 */
import { generateCourseWithFallback } from '@/domain/ai/course-engine';
import { reviewCourseAgainstMaterial } from '@/domain/ai/course-review';
import { enrichLessonsWithKits } from '@/domain/ai/lesson-kit-engine';
import { kitMetrics } from '@/domain/learning/lesson-kit';
import type { LessonKit } from '@/schemas/lesson-kit';

/**
 * Sanitiza o kit antes de gravar.
 *
 * O kit é consumido como texto pelo React (não como HTML), então não há
 * execução possível — mas normalizar aqui mantém o padrão do arquivo: todo
 * campo vindo de modelo passa por `sanitizeAiText` antes de tocar o banco.
 */
function sanitizeKit(kit: LessonKit): LessonKit {
  const text = (value: string, max: number) => sanitizeAiText(value).slice(0, max);
  return {
    video: {
      title: text(kit.video.title, 120),
      scenes: kit.video.scenes.map((scene) => ({
        narration: text(scene.narration, 900),
        onScreen: text(scene.onScreen, 120),
        visual: text(scene.visual, 240),
        seconds: scene.seconds,
      })),
    },
    slides: kit.slides.map((slide) => ({
      title: text(slide.title, 120),
      bullets: slide.bullets.map((bullet) => text(bullet, 200)),
      notes: slide.notes ? text(slide.notes, 900) : undefined,
      visual: slide.visual ? text(slide.visual, 200) : undefined,
    })),
    plain: {
      summary: text(kit.plain.summary, 1200),
      bullets: kit.plain.bullets.map((bullet) => text(bullet, 200)),
      glossary: kit.plain.glossary?.map((entry) => ({
        term: text(entry.term, 80),
        definition: text(entry.definition, 300),
      })),
    },
    checkpoint: kit.checkpoint.map((question) => ({
      question: text(question.question, 500),
      options: question.options.map((option) => text(option, 200)),
      correctIndex: question.correctIndex,
      explanation: question.explanation ? text(question.explanation, 500) : undefined,
      difficulty: question.difficulty,
    })),
  };
}

/** Resumo do que o motor produziu em cada formato — exibido no admin. */
export interface KitSummary {
  lessons: number;
  generated: number;
  derived: number;
  slides: number;
  scenes: number;
  videoSeconds: number;
  checkpointQuestions: number;
  /** Flesch médio dos resumos em linguagem simples (maior = mais fácil). */
  fleschAvg: number;
  promptVersion: string;
  durationMs: number;
}

// ═══════════════════════ Validação de entrada ═══════════════════════

const inputSchema = z.object({
  prompt: z
    .string()
    .min(10, 'Descreva o objetivo do treinamento (mínimo de 10 caracteres).')
    .max(2000),
  sector: z.string().max(60).optional(),
  referenceContent: z.string().max(60000).optional(),
});

export type GenerateTrainingInput = z.infer<typeof inputSchema>;

export interface CoursePayload {
  id: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  quizJson: unknown;
  category?: string;
  estimatedDurationMinutes?: number;
  lessons: Array<{
    id: string;
    title: string;
    type: string;
    pointsAssigned: number;
    contentUrl: string | null;
    blocks?: unknown;
  }>;
}

export type GenerateTrainingResult =
  | {
      success: true;
      courseId: string;
      lessonsCount: number;
      provider: string;
      creditsRemaining: number;
      persisted: boolean;
      requiresReview?: boolean;
      review?: Awaited<ReturnType<typeof reviewCourseAgainstMaterial>>;
      /** O que cada formato entregou: vídeo, slides, leitura fácil, checkpoint. */
      kit?: KitSummary;
      course: CoursePayload;
      aiErrors?: string[];
    }
  | { success: false; error: string };

/** Agrega as métricas dos kits para exibir no admin logo após a geração. */
function summarizeKits(kits: LessonKit[]): Omit<KitSummary, 'generated' | 'derived' | 'promptVersion' | 'durationMs'> & {
  fleschAvg: number;
} {
  const metrics = kits.map(kitMetrics);
  const total = metrics.length || 1;
  return {
    lessons: metrics.length,
    slides: metrics.reduce((sum, m) => sum + m.slides, 0),
    scenes: metrics.reduce((sum, m) => sum + m.scenes, 0),
    videoSeconds: metrics.reduce((sum, m) => sum + m.videoSeconds, 0),
    checkpointQuestions: metrics.reduce((sum, m) => sum + m.checkpointQuestions, 0),
    fleschAvg: Number((metrics.reduce((sum, m) => sum + m.flesch, 0) / total).toFixed(1)),
  };
}

// ═══════════════════════ Motor central (débito atômico) ═════════════

export async function generateTrainingCourse(
  input: GenerateTrainingInput,
): Promise<GenerateTrainingResult> {
  const session = await auth();
  console.log('[course-generator] session:', JSON.stringify({
    hasUser: !!session?.user,
    tenantId: session?.user?.tenantId ?? 'MISSING',
    role: session?.user?.role ?? 'MISSING',
  }));

  if (!session?.user?.tenantId) {
    return { success: false, error: 'Não autenticado.' };
  }
  if (session.user.role !== 'admin_rh') {
    return { success: false, error: `Acesso negado: seu papel é "${session.user.role}", apenas "admin_rh" pode gerar cursos.` };
  }
  const tenantId = session.user.tenantId;

  const MAX_GENERATIONS_PER_DAY = 10;
  const rateLimit = await rateLimitCheck(`ratelimit:generate:${tenantId}`, MAX_GENERATIONS_PER_DAY, 86400);
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: `Limite de ${MAX_GENERATIONS_PER_DAY} gerações por dia atingido. Tente novamente em ${Math.ceil(rateLimit.resetIn / 3600)}h.`,
    };
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }

  const db = getTenantDb(tenantId);

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  console.log('[course-generator] tenant:', JSON.stringify({
    found: !!tenant,
    aiCredits: tenant?.aiCredits ?? 'N/A',
  }));

  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado.' };
  }
  if (tenant.aiCredits < 1) {
    return { success: false, error: `Créditos de IA insuficientes (saldo: ${tenant.aiCredits}).` };
  }

  let generated: Awaited<ReturnType<typeof generateCourseWithFallback>>;
  try {
    generated = await generateCourseWithFallback(parsed.data.prompt, parsed.data.sector ?? '', parsed.data.referenceContent);
  } catch (err) {
    console.error('[course-generator] geração falhou:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Falha ao gerar o curso.',
    };
  }

  // IA-2 — telemetria: qual provedor respondeu, se houve fallback, quanto custou.
  // Sem isto, uma geração que caiu no template local é indistinguível de uma
  // geração por IA bem-sucedida para quem lê os logs.
  logger.info('Curso gerado', {
    provider: generated.meta.provider,
    usedFallback: generated.meta.usedFallback,
    usedJsonMode: generated.meta.usedJsonMode,
    durationMs: generated.meta.durationMs,
    attempts: generated.meta.attempts,
    inputTokens: generated.meta.usage?.inputTokens,
    outputTokens: generated.meta.usage?.outputTokens,
    promptChars: parsed.data.prompt.length,
    referenceChars: parsed.data.referenceContent?.length ?? 0,
  }, 'ai');

  // A9 — revisão de aderência ao material (LLM-as-judge). Não bloqueia a
  // geração: se o juiz falhar, o curso continua rascunho e a decisão de
  // publicar permanece humana.
  const review = await reviewCourseAgainstMaterial(generated.data, parsed.data.referenceContent);
  logger.info('Revisão do curso', {
    status: review.status,
    conflicts: review.status === 'conflicts' ? review.conflicts.length : 0,
    provider: review.status === 'clean' || review.status === 'conflicts' ? review.provider : undefined,
  }, 'ai');

  const now = new Date();
  // Ordena pelas aulas pela ordem didática definida pelo gerador.
  const orderedLessons = [...generated.data.lessons].sort((a, b) => a.order - b.order);
  // 8.2 — Sanitização de conteúdo gerado por IA antes da persistência:
  // títulos/aulas/quiz não podem carregar HTML perigoso para os colaboradores.
  const baseLessons = orderedLessons.map((lesson) => ({
    title: sanitizeAiText(lesson.title).slice(0, 160),
    type: 'text' as const,
    pointsAssigned: Math.max(10, Math.min(100, Math.round(lesson.pointsAwarded))),
    contentUrl: sanitizeAiHtml(lesson.content),
  }));

  // ── Fase 2: kit multi-formato por aula ───────────────────────────────────
  //
  // Roda DEPOIS do curso existir em memória e ANTES da transação: se esta fase
  // falhar inteira, o curso ainda é gravado (a derivação do markdown garante
  // slides e roteiro). Nunca lança, então não pode derrubar a geração.
  const kitResult = await enrichLessonsWithKits({
    lessons: baseLessons.map((lesson) => ({ title: lesson.title, content: lesson.contentUrl })),
    preferredProvider: generated.provider,
  });

  const lessonsToCreate = baseLessons.map((lesson, index) => {
    const kit = kitResult.kits[index];
    return {
      ...lesson,
      blocks: kit ? (sanitizeKit(kit) as Prisma.InputJsonValue) : Prisma.DbNull,
    };
  });

  const kitSummary = summarizeKits(kitResult.kits);
  logger.info('Kit multi-formato gerado', {
    ...kitResult.meta,
    leituras: kitSummary,
  }, 'ai');

  // A3 — JSON nativo, com validação que NÃO derruba a geração.
  //
  // `buildQuizModules` descarta questão inválida (correctIndex fora do
  // intervalo, menos de 2 opções, texto vazio) em vez de lançar. Antes, um quiz
  // vazio ou malformado fazia o `parse` estourar e a geração inteira virava
  // "An error occurred in the Server Components render" em produção.
  //
  // O `id` estável é o que permite o quiz dinâmico: a cada tentativa o servidor
  // sorteia um subconjunto do banco e recompõe a prova para corrigir.
  const quizBuild = buildQuizModules(
    (generated.data.quiz ?? []).map((question) => ({
      question: sanitizeAiText(question.question).slice(0, 500),
      options: question.options.map((option) => sanitizeAiText(option).slice(0, 200)),
      correctIndex: question.correctIndex,
      explanation: sanitizeAiText(question.explanation ?? '').slice(0, 500),
      difficulty: question.difficulty,
    })),
    'Avaliação do Curso',
    (index) => `q${index + 1}`,
  );
  const quizModules = quizBuild.modules;

  if (quizBuild.discarded.length > 0) {
    logger.warn('Questões de quiz descartadas na geração', {
      courseTitle: generated.data.title,
      discarded: quizBuild.discarded,
      provider: generated.provider,
    }, 'ai');
  }

  let courseId: string;
  let lessonRecords: Array<{ id: string; title: string; type: string; pointsAssigned: number; contentUrl: string | null }>;  let creditsRemaining: number;
  let persisted = false;

  try {
    const result = await db.$transaction(async (tx) => {
      // Débito atômico de crédito — instrução única e segura contra race condition.
      // Se a query afetar 0 registos, o tenant não tem crédito → aborta.
      const debit = await tx.tenant.updateMany({
        where: { id: tenantId, aiCredits: { gte: 1 } },
        data: { aiCredits: { decrement: 1 } },
      });
      if (debit.count === 0) {
        throw new Error('INSUFFICIENT_CREDITS');
      }

      const course = await tx.course.create({
        data: {
          tenantId,
          title: generated.data.title,
          description: generated.data.description,
          // IA-5 — curso gerado por IA nasce como RASCUNHO. Publicar é ato
          // humano (PATCH /api/admin/courses/[id]/publish). Antes desta mudança
          // a IA publicava direto: o caso do IA-3 (política de pen drive
          // invertida no quiz) chegaria ao colaborador sem ninguém aprovar.
          status: 'draft',
          aiCreditsSpent: 1,
          // Coluna Json?: NULL de banco exige Prisma.DbNull (null puro é JSON null).
          quizJson: quizModules === null ? Prisma.DbNull : (quizModules as Prisma.InputJsonValue),
          lessons: { create: lessonsToCreate },
        },
        include: {
          lessons: {
            select: { id: true, title: true, type: true, pointsAssigned: true, contentUrl: true },
          },
        },
      });

      const refreshed = await tx.tenant.findUnique({ where: { id: tenantId } });

      return {
        courseId: course.id as string,
        lessons: course.lessons as Array<{ id: string; title: string; type: string; pointsAssigned: number; contentUrl: string | null }>,
        creditsRemaining: (refreshed?.aiCredits ?? 0) as number,
      };
    });

    courseId = result.courseId;
    lessonRecords = result.lessons;
    creditsRemaining = result.creditsRemaining;
    persisted = true;
    console.log('[course-generator] Curso persistido no DB:', courseId);

    // 9.1 — Auditoria de geração de curso (custo de crédito de IA).
    await logAudit({
      tenantId,
      userId: session.user.id,
      action: 'COURSE_GENERATED',
      entity: 'Course',
      entityId: courseId,
      newValue: {
        provider: generated.provider,
        lessonsCount: lessonRecords.length,
        creditsSpent: 1,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'INSUFFICIENT_CREDITS') {
      return { success: false, error: 'Créditos de IA insuficientes para este tenant (concorrência).' };
    }
    console.error('[course-generator] Persistência falhou, retornando dados gerados:', err);
    courseId = randomUUID();
    lessonRecords = lessonsToCreate.map((lesson) => ({
      id: randomUUID(),
      title: lesson.title,
      type: lesson.type,
      pointsAssigned: lesson.pointsAssigned,
      contentUrl: lesson.contentUrl,
    }));
    creditsRemaining = Math.max(0, (tenant.aiCredits ?? 1) - 1);
  }

  try {
    revalidatePath('/admin', 'page');
    revalidatePath('/dashboard', 'page');
    revalidatePath('/cursos', 'page');
    revalidatePath('/api/courses', 'page');
  } catch {}

  return {
    success: true,
    courseId,
    lessonsCount: lessonRecords.length,
    provider: generated.provider,
    creditsRemaining,
    persisted,
    aiErrors: generated.errors,
    // IA-5 / A9 — o curso é rascunho e a revisão diz o que o RH precisa olhar.
    requiresReview: true,
    review,
    kit: {
      ...kitSummary,
      generated: kitResult.meta.generated,
      derived: kitResult.meta.derived,
      promptVersion: kitResult.meta.promptVersion,
      durationMs: kitResult.meta.durationMs,
    },
    course: {
      id: courseId,
      title: generated.data.title,
      description: generated.data.description,
      status: 'draft',
      createdAt: now.toISOString(),
      quizJson: quizModules === null ? Prisma.DbNull : (quizModules as Prisma.InputJsonValue),
      category: generated.data.category,
      estimatedDurationMinutes: generated.data.estimatedDurationMinutes,
      lessons: lessonRecords,
    },
  };
}