import { generateObject, generateText, zodSchema } from 'ai';

import { buildProviderChain, type ProviderAttempt } from '@/lib/ai-providers';
import { lessonKitGenerationSchema, type LessonKit } from '@/schemas/lesson-kit';
import { deriveKitFromMarkdown, normalizeKit } from '@/domain/learning/lesson-kit';
import { extractJsonObject } from './course-engine';

// ═══════════════════════════════════════════════════════════════════════════
// Enriquecimento: markdown → kit (vídeo, slides, leitura fácil, checkpoint)
//
// Por que uma chamada por aula, e não uma chamada para o curso inteiro:
//
//  - orçamento de resposta. Gerar 8 aulas com roteiro, slides e questões em um
//    único JSON estoura o teto do provedor e o sintoma é "JSON truncado" — o
//    modelo é culpado por algo que é aritmética de token.
//  - falha isolada. Se a aula 5 vier malformada, as outras 7 continuam boas e
//    só a 5 cai na derivação local. Em uma chamada única, o curso inteiro cai.
//  - paralelismo. Oito chamadas pequenas em paralelo terminam antes de uma
//    chamada gigante, e cada uma tem prazo próprio.
//
// Quem não tem provedor configurado não fica sem os formatos: `deriveKitFromMarkdown`
// produz slides e roteiro a partir do próprio texto. Pior, porém utilizável —
// nunca vazio.
// ═══════════════════════════════════════════════════════════════════════════

export const KIT_PROMPT_VERSION = process.env.COURSE_KIT_PROMPT_VERSION?.trim() || 'k2';

export const LESSON_KIT_SYSTEM_PROMPT = `Você é redator de treinamento corporativo da Pontufy.
Recebe UMA aula (título + texto em markdown) e devolve o material dela em quatro formatos.

TOM DE VOZ — vale para os quatro formatos:
- Isto vai ser LIDO EM VOZ ALTA por uma voz sintética. Escreva como se estivesse explicando para um colega na copa, não como um ofício.
- Trate por "você". Fale em voz ativa e frase curta. Nada de "cumpre informar", "faz-se necessário", "destarte", "no que tange".
- Nunca use CAIXA ALTA em palavra comum: a voz lê como grito.
- No máximo UMA exclamação em todo o material.
- Nada de alarmismo nem tom de vigilância. "Isso protege você e a equipe" em vez de "o descumprimento é gravíssimo".
- Não comece com "Prezado colaborador". Se couber, comece com uma acolhida curta.

1. VIDEO — roteiro de videoaula narrada, de 3 a 6 cenas.
   - "narration" é FALA, não leitura de slide: frases curtas, tom de conversa, no máximo 70 palavras.
   - "onScreen" é o texto grande da tela: no máximo 8 palavras.
   - "visual" descreve a imagem ou animação de apoio, sem pedir marca ou pessoa real.
   - "seconds" entre 8 e 30, coerente com o tamanho da narração.

2. SLIDES — de 3 a 6, na ordem da aula.
   - "title" até 6 palavras; "bullets" de 2 a 5 itens, cada um até 12 palavras.
   - "notes" é o que o instrutor fala (pode ter 2 frases), no mesmo tom de conversa. "visual" é opcional; use "" se não houver.

3. PLAIN — a mesma aula em linguagem simples, para quem lê no celular entre tarefas.
   - "summary": 3 a 5 frases curtas (máximo 20 palavras cada), voz ativa, sem jargão.
   - "bullets": 3 a 6 pontos-chave de uma linha.
   - "glossary": termos técnicos da aula com definição de até 30 palavras; [] se não houver.

4. CHECKPOINT — 2 a 3 perguntas de fixação sobre ESTA aula.
   - 3 ou 4 opções, "correctIndex" base 0, "explanation" explicando o porquê.
   - "difficulty": facil, medio ou dificil. Varie.

Nunca invente dado, número, lei ou prazo que não esteja no texto da aula.
Responda apenas no schema estruturado solicitado.`;

/** Modo JSON para provedores que ignoram `json_schema`. */
async function generateKitFromText(
  provider: ProviderAttempt,
  lesson: { title: string; content: string },
  signal: AbortSignal,
): Promise<unknown> {
  const jsonSchema = zodSchema(lessonKitGenerationSchema).jsonSchema as unknown;
  const { text, finishReason } = await generateText({
    model: provider.build(),
    system: `${LESSON_KIT_SYSTEM_PROMPT}

Responda SOMENTE com um objeto JSON válido, sem markdown e sem texto antes ou depois.
O objeto deve satisfazer exatamente este JSON Schema:
${JSON.stringify(jsonSchema)}`,
    prompt: `Título da aula: ${lesson.title}\n\n--- AULA ---\n${lesson.content}\n--- FIM ---`,
    temperature: 0.5,
    maxRetries: 1,
    maxOutputTokens: kitBudget(provider),
    abortSignal: signal,
  });

  if (finishReason === 'length') {
    throw new Error('resposta truncada por limite de tokens');
  }
  return extractJsonObject(text);
}

/** Teto do kit: o material é curto por definição; não precisa de 8k tokens. */
function kitBudget(provider: ProviderAttempt): number {
  return Math.max(1200, Math.min(provider.maxOutputTokens, 4096));
}

export interface KitGenerationMeta {
  promptVersion: string;
  /** Provedor que gerou ao menos um kit; null quando todos vieram da derivação. */
  provider: string | null;
  generated: number;
  derived: number;
  durationMs: number;
  errors: string[];
}

export interface EnrichLessonsParams {
  lessons: Array<{ title: string; content: string }>;
  /** Provedor que já respondeu o curso — tentar ele primeiro evita re-sondar. */
  preferredProvider?: string;
  /** Orçamento total desta fase, em ms. Estourou? O resto é derivado. */
  budgetMs?: number;
  concurrency?: number;
}

/** Pool simples: mantém N promessas vivas e preserva a ordem do resultado. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function orderChain(chain: ProviderAttempt[], preferred?: string): ProviderAttempt[] {
  if (!preferred) return chain;
  const normalized = preferred.replace(/\s*\(json-mode\)\s*/i, '').trim();
  const index = chain.findIndex(
    (p) => p.name === normalized || normalized.startsWith(p.name) || p.name.startsWith(normalized),
  );
  if (index <= 0) return chain;
  return [chain[index], ...chain.slice(0, index), ...chain.slice(index + 1)];
}

/**
 * Gera o kit de cada aula, em paralelo limitado, com derivação como piso.
 *
 * Nunca lança: qualquer falha vira kit derivado. O curso gerado já foi pago
 * (crédito debitado), então a fase de enriquecimento não pode destruir valor.
 */
export async function enrichLessonsWithKits(
  params: EnrichLessonsParams,
): Promise<{ kits: LessonKit[]; meta: KitGenerationMeta }> {
  const startedAt = Date.now();
  const budgetMs = params.budgetMs ?? Number(process.env.COURSE_KIT_BUDGET_MS || 75_000);
  const concurrency = params.concurrency ?? Number(process.env.COURSE_KIT_CONCURRENCY || 2);
  const disabled = (process.env.COURSE_KIT_GENERATION || '').trim().toLowerCase() === 'off';

  const chain = disabled ? [] : orderChain(buildProviderChain(), params.preferredProvider);
  const lessons = params.lessons ?? [];

  const meta: KitGenerationMeta = {
    promptVersion: KIT_PROMPT_VERSION,
    provider: null,
    generated: 0,
    derived: 0,
    durationMs: 0,
    errors: [],
  };

  if (lessons.length === 0) {
    return { kits: [], meta };
  }

  if (chain.length === 0) {
    const kits = lessons.map((lesson) => deriveKitFromMarkdown(lesson.content, lesson.title));
    meta.derived = kits.length;
    meta.durationMs = Date.now() - startedAt;
    return { kits, meta };
  }

  const deadline = startedAt + budgetMs;

  const kits = await mapLimited(lessons, concurrency, async (lesson, index) => {
    const fallback = () => {
      meta.derived++;
      return deriveKitFromMarkdown(lesson.content, lesson.title);
    };

    if (Date.now() > deadline) {
      meta.errors.push(`aula ${index + 1}: orçamento de tempo esgotado, kit derivado`);
      return fallback();
    }

    for (const provider of chain) {
      const remaining = deadline - Date.now();
      if (remaining < 3_000) break;
      const timeout = Math.min(provider.timeoutMs, remaining);
      try {
        const { object } = await generateObject({
          model: provider.build(),
          schema: lessonKitGenerationSchema,
          system: LESSON_KIT_SYSTEM_PROMPT,
          prompt: `Título da aula: ${lesson.title}\n\n--- AULA ---\n${lesson.content}\n--- FIM ---`,
          temperature: 0.5,
          maxRetries: 1,
          maxOutputTokens: kitBudget(provider),
          abortSignal: AbortSignal.timeout(timeout),
        });

        meta.generated++;
        meta.provider = provider.name;
        return normalizeKit(object, lesson.content, lesson.title);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Um retry em modo JSON quando o problema foi de formato, não de rede.
        if (
          provider.structured !== 'json' &&
          !/timeout|aborted|429|rate limit|fetch failed|ECONN|truncad/i.test(message)
        ) {
          try {
            const raw = await generateKitFromText(
              provider,
              lesson,
              AbortSignal.timeout(Math.min(provider.timeoutMs, Math.max(3_000, deadline - Date.now()))),
            );
            meta.generated++;
            meta.provider = provider.name;
            return normalizeKit(raw, lesson.content, lesson.title);
          } catch (retryErr) {
            const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
            meta.errors.push(`aula ${index + 1} / ${provider.name} [json]: ${retryMessage.slice(0, 160)}`);
            continue;
          }
        }

        meta.errors.push(`aula ${index + 1} / ${provider.name}: ${message.slice(0, 160)}`);
      }
    }

    return fallback();
  });

  meta.durationMs = Date.now() - startedAt;
  return { kits, meta };
}
