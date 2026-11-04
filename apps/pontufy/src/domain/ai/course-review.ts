import { generateObject } from 'ai';
import { z } from 'zod';

import { buildProviderChain } from '@/lib/ai-providers';
import type { GeneratedCourse } from '@/schemas/course-schema';

// ═══════════════════════════════════════════════════════════════════════════
// A9 — Revisão de aderência ao material (LLM-as-judge)
//
// Motivação medida: no IA-3, o curso de segurança da informação do Groq marcou
// como correta a alternativa "escanear o pen drive com antivírus", enquanto o
// material dizia "pendrives desconhecidos NUNCA devem ser conectados".
// A rubrica automática (schema, idioma, tamanho, aderência por palavras-chave)
// aprovou — 97% de aderência e quiz estruturalmente válido.
//
// Nenhuma heurística de palavra-chave pega negação invertida. Este módulo faz
// a pergunta certa a um modelo, com o material e o curso lado a lado.
//
// Não bloqueia a geração: se o juiz falhar, a revisão fica 'unavailable' e o
// curso continua como rascunho — nunca é publicado sozinho.
// ═══════════════════════════════════════════════════════════════════════════

export const courseReviewSchema = z.object({
  conflicts: z
    .array(
      z.object({
        rule: z.string().describe('Regra do material que foi contrariada, citada literalmente'),
        finding: z.string().describe('Trecho do curso que contraria a regra'),
        severity: z.enum(['high', 'medium']),
      }),
    )
    .describe('Lista vazia se o curso não contraria nenhuma regra do material'),
  unverifiable: z
    .array(z.string())
    .describe('Afirmações do curso que o material não permite verificar'),
});

export type CourseReviewConflicts = z.infer<typeof courseReviewSchema>;

export type CourseReview =
  | { status: 'clean'; provider: string; conflicts: []; unverifiable: string[] }
  | { status: 'conflicts'; provider: string; conflicts: CourseReviewConflicts['conflicts']; unverifiable: string[] }
  | { status: 'unavailable'; reason: string }
  | { status: 'skipped'; reason: 'sem-material' };

const REVIEW_SYSTEM_PROMPT = `Você é um revisor de conformidade de treinamentos corporativos.

Receberá um MATERIAL DE REFERÊNCIA (política interna) e um CURSO gerado a partir dele.
Sua única tarefa é encontrar CONTRADIÇÕES: pontos em que o curso afirma algo diferente
do que o material determina.

Regras:
- Compare aula por aula e questão por questão.
- Uma questão do quiz cuja alternativa marcada como correta contraria o material é a
  contradição mais grave: o colaborador que seguir a política será reprovado.
- Cite a regra do material literalmente e o trecho do curso que a contraria.
- NÃO invente regras que o material não contém.
- Se o curso estiver de acordo, devolva a lista de conflitos vazia.
- Listas de negação importam: "nunca conecte" não é o mesmo que "conecte com cuidado".`;

function buildReviewPrompt(course: GeneratedCourse, referenceContent: string): string {
  const courseText = [
    `TÍTULO: ${course.title}`,
    `DESCRIÇÃO: ${course.description}`,
    '',
    ...course.lessons.map((lesson) => `## AULA ${lesson.order}: ${lesson.title}\n${lesson.content}`),
    '',
    '## QUIZ',
    ...course.quiz.map((question, index) => {
      const options = question.options
        .map((option, i) => `${i === question.correctIndex ? '[CORRETA]' : '[    ]'} ${option}`)
        .join('\n   ');
      return `${index + 1}. ${question.question}\n   ${options}`;
    }),
  ].join('\n');

  return `MATERIAL DE REFERÊNCIA:
${referenceContent.slice(0, 25000)}

--- FIM DO MATERIAL ---

CURSO GERADO:
${courseText.slice(0, 25000)}

--- FIM DO CURSO ---

Liste as contradições entre o curso e o material.`;
}

/**
 * Compara o curso gerado com o material de referência.
 *
 * `curso sem material` não tem o que revisar: a revisão é 'skipped' e a
 * decisão de publicar continua humana.
 */
export async function reviewCourseAgainstMaterial(
  course: GeneratedCourse,
  referenceContent: string | undefined,
): Promise<CourseReview> {
  if (!referenceContent || referenceContent.trim().length < 40) {
    return { status: 'skipped', reason: 'sem-material' };
  }

  const chain = buildProviderChain();
  if (chain.length === 0) {
    return { status: 'unavailable', reason: 'nenhum provedor de IA configurado' };
  }

  const prompt = buildReviewPrompt(course, referenceContent);
  const failures: string[] = [];

  for (const attempt of chain) {
    try {
      const { object } = await generateObject({
        model: attempt.build(),
        schema: courseReviewSchema,
        system: REVIEW_SYSTEM_PROMPT,
        prompt,
        temperature: 0.1,
        maxRetries: 1,
        maxOutputTokens: Math.min(attempt.maxOutputTokens, 8192),
        abortSignal: AbortSignal.timeout(attempt.timeoutMs),
      });

      if (object.conflicts.length > 0) {
        console.warn(
          `[course-review] ${object.conflicts.length} conflito(s) com o material (${attempt.name})`,
        );
        return {
          status: 'conflicts',
          provider: attempt.name,
          conflicts: object.conflicts,
          unverifiable: object.unverifiable ?? [],
        };
      }

      return { status: 'clean', provider: attempt.name, conflicts: [], unverifiable: object.unverifiable ?? [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[course-review] Falha no provedor ${attempt.name}:`, message);
      failures.push(`${attempt.name}: ${message}`);
    }
  }

  return {
    status: 'unavailable',
    reason: `nenhum provedor conseguiu revisar — ${failures.join(' | ').slice(0, 300)}`,
  };
}

/** `true` quando a revisão exige ação humana antes de publicar. */
export function reviewBlocksPublication(review: CourseReview): boolean {
  if (review.status === 'conflicts') return true;
  // Sem revisão não há como afirmar conformidade: o curso fica em rascunho.
  return review.status === 'unavailable';
}
