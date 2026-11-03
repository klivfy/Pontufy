import { generateObject, generateText, zodSchema } from 'ai';

import { buildProviderChain, type ProviderAttempt } from '@/lib/ai-providers';
import { courseGenerationSchema, generatedCourseSchema } from '@/schemas/course-schema';
import type { GeneratedCourse } from '@/schemas/course-schema';

// ═══════════════════════════════════════════════════════════════════════════
// Motor de geração de cursos (domínio)
//
// Extraído de `src/actions/course-generator.ts`, que é um módulo 'use server':
// tudo lá é server action e não pode ser importado por script, teste ou job.
// A regra de negócio (prompt, cadeia de provedores, fallback) pertence a
// `domain/`; a action fica só com sessão, validação de entrada, créditos e
// revalidação de cache — o mesmo desenho exigido pelo CLAUDE.md para rotas.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_OUTPUT_TOKENS = Number(process.env.COURSE_MAX_OUTPUT_TOKENS || 8192);

export const COURSE_SYSTEM_PROMPT = `Você é o motor de IA da Pontufy, uma plataforma B2B de educação corporativa gamificada.
Gere um curso de treinamento COMPLETO, prático e adaptado ao setor/vertical informado.

Regras OBRIGATÓRIAS:
1. FOCO SETORIAL — Adapte títulos, exemplos e vocabulário ao setor. Nada genérico.
2. ESTRUTURA — Entregue de 3 a 8 aulas, em ordem didática (do fundamental ao avançado). Use o campo "order" para numerar (1, 2, 3...).
3. CONTEÚDO COMPLETO — Cada aula DEVE ter conteúdo educacional rico e completo:
   - Mínimo de 3 parágrafos substanciais (150+ palavras cada) — o "content" DEVE ter pelo menos 200 caracteres úteis.
   - Explique conceitos-chave de forma clara e detalhada.
   - Inclua exemplos práticos e reais do setor informado.
   - Adicione boas práticas, dicas e alertas importantes.
   - Use formatação Markdown: ## para subtítulos, **negrito** para termos-chave, - para listas.
   - NUNCA use resumos curtos: o conteúdo deve ser completo e autossuficiente.
4. PONTUAÇÃO — "pointsAwarded" é um inteiro entre 10 e 100: aulas introdutórias valem menos, avançadas valem mais.
5. QUIZ — Gere de 2 a 8 perguntas de múltipla escolha cobrindo TODO o conteúdo do curso:
   - Cada pergunta deve ter de 3 a 5 opções ("options") e o índice da correta em "correctIndex" (base 0).
   - Perguntas devem testar compreensão real, não memorização superficial.
   - Varie a dificuldade: fáceis, médias e difíceis.
6. META — Informe "category" (categoria do curso) e "estimatedDurationMinutes" (tempo estimado em minutos).
7. Se material de referência for fornecido, BASEIE o conteúdo nele.
8. Responda exclusivamente no schema estruturado solicitado.`;

// ═══════════════════════ Fallback local determinístico ═══════════════

function generateLocalFallback(prompt: string, sector: string, referenceContent?: string): GeneratedCourse {
  const sectorName = sector || 'geral';
  const topic = prompt.slice(0, 80);

  if (referenceContent && referenceContent.length > 50) {
    const paragraphs = referenceContent
      .split(/\n{2,}|\r\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 30);

    const chunks: string[][] = [];
    const chunkSize = Math.max(1, Math.ceil(paragraphs.length / 5));
    for (let i = 0; i < paragraphs.length; i += chunkSize) {
      chunks.push(paragraphs.slice(i, i + chunkSize));
    }

    const lessonCount = Math.min(Math.max(3, chunks.length), 6);
    const titles = [
      'Fundamentos e Introdução',
      'Conceitos Principais',
      'Desenvolvimento e Aplicação',
      'Aprofundamento Prático',
      'Estudos de Caso',
      'Avaliação e Consolidação',
    ];

    const lessons = Array.from({ length: lessonCount }, (_, i) => {
      const chunk = chunks[i] || [];
      const chunkText = chunk.length > 0
        ? chunk.join('\n\n')
        : `Conteúdo sobre ${topic} aplicado ao setor de ${sectorName}.`;
      return {
        title: titles[i] || `Módulo ${i + 1}`,
        content: `## ${titles[i] || `Módulo ${i + 1}`}\n\n${chunkText}\n\n**Dica prática:** Aplique estes conceitos no seu dia a dia no setor de ${sectorName} para obter melhores resultados.`,
        pointsAwarded: Math.min(10 + i * 10, 100),
        order: i + 1,
      };
    });

    return {
      title: `Treinamento: ${prompt.slice(0, 60)}`,
      description: `Curso baseado no material de referência fornecido sobre "${prompt.slice(0, 100)}" para o setor de ${sectorName}.`,
      category: sectorName,
      estimatedDurationMinutes: lessons.length * 15,
      lessons,
      quiz: [
        { question: `Qual é o principal objetivo deste treinamento sobre ${topic}?`, options: ['Desenvolvimento de habilidades práticas', 'Apenas teoria sem aplicação', 'Recreação corporativa', 'Redução de custos imediata'], correctIndex: 0 },
        { question: `Em qual setor este treinamento é mais aplicável?`, options: ['Qualquer setor sem distinção', `Setor de ${sectorName}`, 'Apenas setor público', 'Apenas startups'], correctIndex: 1 },
        { question: 'Qual a melhor forma de aplicar o conteúdo aprendido?', options: ['Ignorar até surgir necessidade', 'Aplicar imediatamente na rotina de trabalho', 'Esperar instruções do gestor', 'Estudar mais teoria antes de praticar'], correctIndex: 1 },
      ],
    };
  }

  return {
    title: `Treinamento: ${prompt.slice(0, 60)}`,
    description: `Curso sobre "${prompt.slice(0, 100)}" para o setor de ${sectorName}. Configure uma chave de IA (GEMINI_API_KEY) no Vercel para gerar conteúdo personalizado e inteligente.`,
    category: sectorName,
    estimatedDurationMinutes: 60,
    lessons: [
      {
        title: 'Introdução e Contexto',
        content: `## Introdução ao Treinamento\n\nBem-vindo a este treinamento sobre **${topic}**, desenvolvido especificamente para profissionais do setor de **${sectorName}**. Nesta primeira aula, você vai entender por que este tema é fundamental para o seu desenvolvimento profissional e como ele se aplica ao seu dia a dia.\n\n## Por que este tema é importante?\n\nO mercado atual exige profissionais cada vez mais preparados e atualizados. No setor de ${sectorName}, dominar **${topic}** pode ser o diferencial entre uma carreira estagnada e uma trajetória de crescimento contínuo. Empresas que investem no desenvolvimento de seus colaboradores nesta área observam melhorias significativas em produtividade e qualidade.\n\n## Objetivos do Treinamento\n\nAo longo deste curso, você irá:\n\n- Compreender os **fundamentos essenciais** do tema\n- Conhecer as **melhores práticas** do mercado\n- Aplicar o conhecimento em **situações reais** do seu setor\n- Desenvolver habilidades práticas para o dia a dia\n\n**Dica:** Aproveite cada aula para refletir sobre como aplicar o conteúdo na sua rotina de trabalho.`,
        pointsAwarded: 10,
        order: 1,
      },
      {
        title: 'Conceitos Essenciais e Boas Práticas',
        content: `## Conceitos-Chave\n\nNesta aula, vamos aprofundar nos conceitos fundamentais de **${topic}** que todo profissional do setor de **${sectorName}** precisa dominar. Estes conceitos formam a base para todas as práticas avançadas que veremos adiante.\n\n## Princípios Fundamentais\n\nExistem alguns princípios que guiam as melhores práticas nesta área:\n\n- **Planejamento estratégico**: Antes de qualquer ação, é essencial ter um plano claro com objetivos mensuráveis\n- **Execução disciplinada**: Seguir processos bem definidos garante consistência nos resultados\n- **Melhoria contínua**: Avaliar resultados regularmente e ajustar a abordagem conforme necessário\n- **Colaboração**: Trabalhar em equipe potencializa os resultados individuais\n\n## Boas Práticas do Mercado\n\nProfissionais de destaque no setor de ${sectorName} seguem estas boas práticas:\n\n1. **Documentar processos** — Manter registros claros facilita a replicação de sucessos\n2. **Buscar feedback** — Ouvir colegas e gestores acelera o aprendizado\n3. **Atualizar-se constantemente** — O mercado evolui e quem não acompanha fica para trás\n4. **Compartilhar conhecimento** — Ensinar aos outros consolida o próprio aprendizado\n\n**Importante:** Aplique pelo menos uma destas práticas já na próxima semana de trabalho.`,
        pointsAwarded: 20,
        order: 2,
      },
      {
        title: 'Aplicação Prática e Estudos de Caso',
        content: `## Colocando em Prática\n\nAgora que você domina os conceitos fundamentais, é hora de ver como eles se aplicam em **situações reais** do setor de **${sectorName}**. A prática é o que transforma conhecimento teórico em habilidade profissional.\n\n## Estudo de Caso: Aplicação no Dia a Dia\n\nImagine a seguinte situação no seu ambiente de trabalho: você precisa aplicar os conceitos de **${topic}** para resolver um desafio comum do setor. O primeiro passo é **identificar o problema** com clareza, depois **mapear as opções** disponíveis e, por fim, **implementar a solução** mais adequada ao contexto.\n\nProfissionais que seguem esta abordagem estruturada conseguem resultados até **40% melhores** do que aqueles que agem por impulso.\n\n## Exercício de Reflexão\n\nPense em uma situação recente no seu trabalho onde você poderia ter aplicado estes conceitos:\n\n- Qual era o **desafio** que você enfrentava?\n- Quais **opções** você tinha disponível?\n- O que você faria **diferente** agora com este conhecimento?\n\n## Próximos Passos\n\nDepois de concluir este treinamento:\n\n- **Semana 1**: Identifique uma oportunidade de aplicar o aprendizado\n- **Semana 2**: Implemente a ação e registre os resultados\n- **Semana 3**: Avalie o impacto e compartilhe com sua equipe\n\n**Parabéns!** Você está no caminho certo para se destacar no setor de ${sectorName}.`,
        pointsAwarded: 30,
        order: 3,
      },
      {
        title: 'Avaliação e Próximos Passos',
        content: `## Revisão do Conteúdo\n\nParabéns por chegar à última aula deste treinamento sobre **${topic}**! Vamos revisar os principais pontos abordados e preparar você para continuar se desenvolvendo.\n\n## O que Aprendemos\n\nAo longo deste curso, você:\n\n- Compreendeu a **importância** de ${topic} no setor de ${sectorName}\n- Dominou os **conceitos essenciais** e boas práticas do mercado\n- Viu **exemplos práticos** de aplicação no dia a dia\n- Desenvolveu um **plano de ação** para implementar o aprendizado\n\n## Como Continuar Evoluindo\n\nO aprendizado não termina aqui. Para continuar se desenvolvendo:\n\n- **Pratique regularmente** — A repetição é a mãe do aprendizado\n- **Busque mentoria** — Encontre alguém mais experiente para guiá-lo\n- **Acompanhe tendências** — O setor de ${sectorName} está em constante evolução\n- **Compartilhe** — Ensine o que aprendeu para colegas e equipe\n\n## Certificação\n\nApós concluir todas as aulas e o quiz de avaliação, você poderá baixar seu **certificado de conclusão**. Este certificado valida sua dedicação ao desenvolvimento profissional e pode ser compartilhado com seu gestor.\n\n**Obrigado pela dedicação!** Continue investindo no seu crescimento profissional.`,
        pointsAwarded: 40,
        order: 4,
      },
    ],
    quiz: [
      {
        question: `Qual é o primeiro passo recomendado ao aplicar os conceitos de ${topic} no ambiente de trabalho?`,
        options: [
          'Agir por impulso para ganhar velocidade',
          'Identificar o problema com clareza antes de agir',
          'Esperar que o gestor tome a iniciativa',
          'Delegar a tarefa para outro colega',
        ],
        correctIndex: 1,
      },
      {
        question: 'Qual das seguintes é uma boa prática recomendada neste treinamento?',
        options: [
          'Trabalhar isoladamente para maior foco',
          'Evitar documentar processos para economizar tempo',
          'Buscar feedback de colegas e gestores regularmente',
          'Aplicar o conhecimento apenas quando solicitado',
        ],
        correctIndex: 2,
      },
      {
        question: `Por que a melhoria contínua é importante no setor de ${sectorName}?`,
        options: [
          'Apenas para cumprir exigências da empresa',
          'O mercado evolui e profissionais precisam se atualizar',
          'É uma exigência legal obrigatória',
          'Não é realmente importante',
        ],
        correctIndex: 1,
      },
      {
        question: 'Qual a recomendação para a primeira semana após concluir o treinamento?',
        options: [
          'Esquecer o conteúdo e voltar à rotina normal',
          'Fazer outro treinamento imediatamente',
          'Identificar uma oportunidade de aplicar o aprendizado',
          'Aguardar instruções específicas do RH',
        ],
        correctIndex: 2,
      },
    ],
  };
}

// ═══════════════════════ Geração com fallback ═══════════════════════

/**
 * Telemetria da geração (IA-2).
 *
 * Existe porque uma falha de provedor pode passar por sucesso: o motor cai no
 * template local e a resposta continua `success: true`. Sem registrar qual
 * provedor respondeu, quanto demorou e se houve recuperação, esse tipo de
 * problema só aparece quando um cliente reclama da qualidade do curso.
 */
export interface CourseGenerationMeta {
  /** Provedor que entregou o conteúdo (`local:*` indica template). */
  provider: string;
  /** `true` quando o resultado veio do template, não de um modelo. */
  usedFallback: boolean;
  /** `true` quando a resposta foi obtida em modo JSON (provedor sem schema). */
  usedJsonMode: boolean;
  durationMs: number;
  /** Tentativas na ordem em que ocorreram. */
  attempts: Array<{ provider: string; ok: boolean; durationMs: number; error?: string }>;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Extrai o primeiro objeto JSON de um texto que pode vir com cerca markdown,
 * preâmbulo ou texto depois do JSON.
 *
 * Necessário porque nem todo endpoint "compatível com OpenAI" honra
 * `response_format: json_schema` — o Ollama Cloud devolve o JSON dentro de um
 * bloco ```json mesmo quando instruído a responder só com o objeto.
 */
function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // Fallback: recorta do primeiro `{` até o último `}` (prosa antes/depois).
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('nenhum JSON encontrado na resposta do modelo');
  }
}

/**
 * Segunda tentativa para provedores sem structured output real.
 *
 * Em vez de `generateObject` (que exige `json_schema`), pede o JSON no próprio
 * prompt — incluindo o schema — e valida com Zod. É o que recupera modelos como
 * `gpt-oss` no Ollama Cloud, que ignoram `response_format`.
 */
async function generateCourseFromText(
  provider: ProviderAttempt,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<GeneratedCourse> {
  const jsonSchema = zodSchema(courseGenerationSchema).jsonSchema as unknown;
  const { text, finishReason } = await generateText({
    model: provider.build(),
    system: `${COURSE_SYSTEM_PROMPT}

Responda SOMENTE com um objeto JSON válido, sem markdown, sem comentários e sem texto antes ou depois.
O objeto deve satisfazer exatamente este JSON Schema:
${JSON.stringify(jsonSchema)}`,
    prompt: userPrompt,
    temperature: 0.6,
    maxRetries: 1,
    maxOutputTokens: provider.maxOutputTokens,
    abortSignal: signal,
  });

  // Modelos de raciocínio (gpt-oss, o1-like) gastam o orçamento em `reasoning`
  // e truncam o JSON no meio. Sem esta checagem o sintoma seria "JSON inválido"
  // e a causa real (teto de tokens) ficaria invisível.
  if (finishReason === 'length') {
    throw new Error(
      `resposta truncada por limite de tokens (COURSE_MAX_OUTPUT_TOKENS=${MAX_OUTPUT_TOKENS}). ` +
        'Modelos de raciocínio consomem o orçamento em reasoning — aumente o limite.',
    );
  }

  return generatedCourseSchema.parse(extractJsonObject(text));
}

export async function generateCourseWithFallback(
  prompt: string,
  sector: string,
  referenceContent?: string,
): Promise<{
  data: GeneratedCourse;
  provider: string;
  errors?: string[];
  meta: CourseGenerationMeta;
}> {
  const startedAt = Date.now();
  const attempts: CourseGenerationMeta['attempts'] = [];
  const chain = buildProviderChain();

  if (chain.length === 0) {
    console.log('[course-generator] Nenhum provedor configurado, usando template local');
    return {
      data: generateLocalFallback(prompt, sector, referenceContent),
      provider: 'local:template',
      meta: {
        provider: 'local:template',
        usedFallback: true,
        usedJsonMode: false,
        durationMs: Date.now() - startedAt,
        attempts: [],
      },
    };
  }

  let userPrompt = `Setor/Vertical: ${sector || 'geral'}.
Objetivo do treinamento solicitado pelo RH: ${prompt}`;

  if (referenceContent) {
    userPrompt += `\n\n--- MATERIAL DE REFERÊNCIA FORNECIDO ---\n${referenceContent.slice(0, 30000)}\n--- FIM DO MATERIAL ---\n\nIMPORTANTE: Baseie o conteúdo do curso no material acima. Extraia os tópicos principais, organize-os didaticamente e gere as aulas com base real no conteúdo fornecido.`;
  }

  const errors: string[] = [];
  for (const attempt of chain) {
    // Prazo por provedor: o OpenRouter pode levar ~70 s e não pode consumir o
    // tempo da função serverless inteira quando há um provedor rápido atrás.
    const signal = AbortSignal.timeout(attempt.timeoutMs);
    const attemptStartedAt = Date.now();

    const succeed = (
      data: GeneratedCourse,
      provider: string,
      jsonMode: boolean,
      usage?: { inputTokens?: number; outputTokens?: number },
    ) => {
      attempts.push({ provider, ok: true, durationMs: Date.now() - attemptStartedAt });
      return {
        data,
        provider,
        meta: {
          provider,
          usedFallback: provider.startsWith('local'),
          usedJsonMode: jsonMode,
          durationMs: Date.now() - startedAt,
          attempts,
          usage,
        },
      };
    };

    try {
      console.log(`[course-generator] Tentando provedor: ${attempt.name} (${attempt.structured})`);

      // `structured: 'json'` — o provedor já sabe que ignora json_schema
      // (Ollama Cloud). Ir direto ao modo JSON economiza uma chamada perdida.
      if (attempt.structured === 'json') {
        const course = await generateCourseFromText(attempt, userPrompt, signal);
        console.log(`[course-generator] Sucesso em modo JSON com ${attempt.name}`);
        return succeed(course, `${attempt.name} (json-mode)`, true);
      }

      const { object, usage } = await generateObject({
        model: attempt.build(),
        // Schema ESTRITO: todo campo em `required`. Com o schema canônico
        // (que tem `.default()`), provedores de structured output estrito
        // rejeitam o request com 400 antes de chamar o modelo.
        schema: courseGenerationSchema,
        system: COURSE_SYSTEM_PROMPT,
        prompt: userPrompt,
        temperature: 0.6,
        maxRetries: 1,
        maxOutputTokens: attempt.maxOutputTokens,
        abortSignal: signal,
      });
      // Normaliza para o contrato canônico (aplica defaults e descarta extras).
      const course = generatedCourseSchema.parse(object);
      console.log(`[course-generator] Sucesso com ${attempt.name}`);
      return succeed(course, attempt.name, false, {
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[course-generator] Falha em ${attempt.name}:`, msg);
      errors.push(`${attempt.name}: ${msg}`);
      attempts.push({
        provider: attempt.name,
        ok: false,
        durationMs: Date.now() - attemptStartedAt,
        error: msg.slice(0, 200),
      });

      // IA-1.5 — recuperação para provedores que ignoram `json_schema`
      // (Ollama Cloud, alguns modelos :free). Só vale a pena quando o problema
      // foi de formato/schema; erro de rede, 429 ou timeout não se resolve
      // reescrevendo o prompt.
      if (
        attempt.structured !== 'json' &&
        !/timeout|aborted|429|rate limit|fetch failed|ECONN/i.test(msg) &&
        /did not match schema|could not parse|No object generated|json/i.test(msg)
      ) {
        try {
          console.log(`[course-generator] Repetindo ${attempt.name} em modo JSON`);
          const course = await generateCourseFromText(
            attempt,
            userPrompt,
            AbortSignal.timeout(attempt.timeoutMs),
          );
          console.log(`[course-generator] Sucesso em modo JSON com ${attempt.name}`);
          return succeed(course, `${attempt.name} (json-mode)`, true);
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          console.error(`[course-generator] Falha também em modo JSON (${attempt.name}):`, retryMsg);
          errors.push(`${attempt.name} [json-mode]: ${retryMsg}`);
          attempts.push({
            provider: `${attempt.name} [json-mode]`,
            ok: false,
            durationMs: Date.now() - attemptStartedAt,
            error: retryMsg.slice(0, 200),
          });
        }
      }
    }
  }

  console.warn('[course-generator] Todos os provedores falharam, usando template local:', errors.join(' | '));
  return {
    data: generateLocalFallback(prompt, sector, referenceContent),
    provider: 'local:fallback',
    errors,
    meta: {
      provider: 'local:fallback',
      usedFallback: true,
      usedJsonMode: false,
      durationMs: Date.now() - startedAt,
      attempts,
    },
  };
}

