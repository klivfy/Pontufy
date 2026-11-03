'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

import { auth } from '@/auth';
import { getTenantDb } from '@/backend/db';
import { rateLimitCheck } from '@/lib/redis';
import { sanitizeAiHtml, sanitizeAiText } from '@/lib/validations/security';
import { logAudit } from '@/lib/audit';
import type { GeneratedCourse } from '@/schemas/course-schema';

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
  quizJson: string | null;
  category?: string;
  estimatedDurationMinutes?: number;
  lessons: Array<{
    id: string;
    title: string;
    type: string;
    pointsAssigned: number;
    contentUrl: string | null;
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
      course: CoursePayload;
      aiErrors?: string[];
    }
  | { success: false; error: string };

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

  let generated: { data: GeneratedCourse; provider: string; errors?: string[] };
  try {
    generated = await generateCourseWithFallback(parsed.data.prompt, parsed.data.sector ?? '', parsed.data.referenceContent);
  } catch (err) {
    console.error('[course-generator] geração falhou:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Falha ao gerar o curso.',
    };
  }

  const now = new Date();
  // Ordena pelas aulas pela ordem didática definida pelo gerador.
  const orderedLessons = [...generated.data.lessons].sort((a, b) => a.order - b.order);
  // 8.2 — Sanitização de conteúdo gerado por IA antes da persistência:
  // títulos/aulas/quiz não podem carregar HTML perigoso para os colaboradores.
  const lessonsToCreate = orderedLessons.map((lesson) => ({
    title: sanitizeAiText(lesson.title).slice(0, 160),
    type: 'text' as const,
    pointsAssigned: Math.max(10, Math.min(100, Math.round(lesson.pointsAwarded))),
    contentUrl: sanitizeAiHtml(lesson.content),
  }));

  const quizJson = generated.data.quiz && generated.data.quiz.length > 0
    ? JSON.stringify([{
        module: 'Avaliação do Curso',
        questions: generated.data.quiz.map((q) => ({
          question: sanitizeAiText(q.question).slice(0, 500),
          options: q.options.map((o) => ({ text: sanitizeAiText(o).slice(0, 200) })),
          correctIndex: q.correctIndex,
          explanation: sanitizeAiText(q.explanation ?? '').slice(0, 500),
        })),
      }])
    : null;

  let courseId: string;
  let lessonRecords: Array<{ id: string; title: string; type: string; pointsAssigned: number; contentUrl: string | null }>;
  let creditsRemaining: number;
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
          status: 'published',
          aiCreditsSpent: 1,
          quizJson,
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
    lessonRecords = lessonsToCreate.map((l) => ({ ...l, id: randomUUID() }));
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
    course: {
      id: courseId,
      title: generated.data.title,
      description: generated.data.description,
      status: 'published',
      createdAt: now.toISOString(),
      quizJson,
      category: generated.data.category,
      estimatedDurationMinutes: generated.data.estimatedDurationMinutes,
      lessons: lessonRecords,
    },
  };
}
