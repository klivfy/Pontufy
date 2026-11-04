import {
  type LessonKit,
  type PlainText,
  type Slide,
  type VideoScene,
  checkpointQuestionSchema,
  lessonKitSchema,
  lessonVideoSchema,
  plainTextSchema,
  slideSchema,
  videoSceneSchema,
} from '@/schemas/lesson-kit';
import { analyzeReadability, makePlainLanguage, splitSentences, stripMarkdown } from './readability';
import { analyzeTone, humanizeTone } from './tone';

// ═══════════════════════════════════════════════════════════════════════════
// Derivação do kit a partir do markdown
//
// Existe por dois motivos, e os dois são de produto:
//
// 1. CURSO LEGADO. Todo curso criado antes deste motor só tem markdown. Se o
//    player novo dependesse de um kit gerado, metade do catálogo ficaria sem
//    slides e sem vídeo da noite para o dia. Aqui o kit é derivado do próprio
//    conteúdo — sem IA, sem migration de dados, determinístico.
//
// 2. FALLBACK. Quando todos os provedores falham, o motor cai no template
//    local. Antes, isso significava um curso de texto genérico; agora o mesmo
//    template ganha slides e roteiro de vídeo coerentes com o que ele escreveu.
//
// O resultado nunca é melhor que o de um modelo bom — é legível, curto e fiel
// ao texto. É o piso, não o teto.
//
// REGRA DE FERRO: estas funções não lançam. Uma aula com markdown estranho
// precisa renderizar, não derrubar a tela do colaborador.
// ═══════════════════════════════════════════════════════════════════════════

export interface MarkdownSection {
  title: string;
  body: string;
}

/** Texto mínimo que satisfaz `plainTextSchema` quando o conteúdo é pobre. */
function padSummary(text: string, lessonTitle: string): string {
  const base = text.trim() || `Resumo da aula ${lessonTitle}.`;
  if (base.length >= 40) return base;
  const filler = ` Aula do curso sobre ${lessonTitle}, em linguagem simples.`;
  return `${base}${filler}`.slice(0, 600);
}

/** Garante pelo menos dois marcadores (o contrato exige ≥ 2). */
function padBullets(bullets: string[], lessonTitle: string): string[] {
  const clean = bullets.map((b) => b.trim()).filter((b) => b.length >= 5).slice(0, 8);
  const defaults = [`Aula: ${lessonTitle}`, 'Aplicação prática no dia a dia', 'Pontos de atenção'];
  for (const candidate of defaults) {
    if (clean.length >= 2) break;
    if (!clean.includes(candidate)) clean.push(candidate);
  }
  return clean.slice(0, 8);
}

/** Quebra o markdown em seções por cabeçalho. Sem cabeçalho, agrupa parágrafos. */
export function splitMarkdownSections(markdown: string, fallbackTitle: string): MarkdownSection[] {
  const source = (markdown ?? '').replace(/\r\n/g, '\n').trim();
  if (!source) return [];

  const headingRe = /^#{1,3}\s+(.+)$/gm;
  const marks: Array<{ title: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(source))) {
    marks.push({
      title: stripMarkdown(match[1]).trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (marks.length === 0) {
    const paragraphs = source.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const groups: MarkdownSection[] = [];
    const perGroup = Math.max(1, Math.ceil(paragraphs.length / 4));
    for (let i = 0; i < paragraphs.length; i += perGroup) {
      const chunk = paragraphs.slice(i, i + perGroup);
      const firstWords = stripMarkdown(chunk[0] ?? '').split(/\s+/).slice(0, 6).join(' ');
      groups.push({
        title: groups.length === 0 ? fallbackTitle : firstWords || `${fallbackTitle} (cont.)`,
        body: chunk.join('\n\n'),
      });
    }
    return groups.slice(0, 8);
  }

  const preamble = source.slice(0, marks[0].start).trim();
  const sections: MarkdownSection[] = [];
  if (preamble.length > 60) sections.push({ title: fallbackTitle, body: preamble });

  marks.forEach((mark, index) => {
    const bodyEnd = index + 1 < marks.length ? marks[index + 1].start : source.length;
    const body = source.slice(mark.end, bodyEnd).trim();
    if (body) sections.push({ title: mark.title || fallbackTitle, body });
  });

  return sections.slice(0, 8);
}

/** Marcadores de um trecho: listas primeiro, frases curtas depois. */
function bulletsFrom(body: string, max = 5): string[] {
  const listItems = Array.from(body.matchAll(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/gm))
    .map((m) => stripMarkdown(m[1]).trim())
    .filter((s) => s.length >= 8 && s.length <= 160);

  if (listItems.length >= 2) return listItems.slice(0, max);

  return splitSentences(body)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 160)
    .slice(0, max);
}

function clamp(text: string, max: number): string {
  const clean = (text ?? '').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max).trim()}…`;
}

/** Segundos de fala para um texto: ~2,6 palavras/segundo, com piso e teto. */
export function estimateSceneSeconds(text: string): number {
  const words = stripMarkdown(text).split(/\s+/).filter(Boolean).length;
  return Math.max(6, Math.min(45, Math.round(words / 2.6)));
}

/** Glossário a partir dos termos em **negrito** do texto. */
function glossaryFrom(markdown: string): PlainText['glossary'] {
  const seen = new Set<string>();
  const entries: NonNullable<PlainText['glossary']> = [];
  const re = /\*\*([^*]{3,60})\*\*/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(markdown)) && entries.length < 6) {
    const term = stripMarkdown(match[1]).trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    const around = markdown.slice(Math.max(0, match.index - 400), match.index + 400);
    const sentence = splitSentences(around).find((s) => s.toLowerCase().includes(key));
    if (!sentence || sentence.length < 25) continue;

    // A frase colhida costuma começar com o cabeçalho/contexto anterior
    // ("Boas práticas iniciais Mapeamento de dados: ..."). Corta até o termo
    // quando ele aparece como abertura de definição.
    const lower = sentence.toLowerCase();
    const termAt = lower.indexOf(key);
    const colonAt = sentence.indexOf(':', termAt);
    const definition =
      termAt > 0 && colonAt > termAt && colonAt - termAt < 80
        ? sentence.slice(colonAt + 1).trim()
        : termAt > 24
          ? sentence.slice(termAt).replace(/^[a-zà-ú]/, (c) => c.toUpperCase()).trim()
          : sentence;

    if (definition.length < 20) continue;
    seen.add(key);
    entries.push({ term, definition: clamp(definition, 240) });
  }

  return entries.length > 0 ? entries : undefined;
}

function sceneFromSection(section: MarkdownSection): VideoScene {
  // A narração é FALA. Passa pelo filtro de tom para não sair com "cumpre
  // informar" nem caixa alta — o que a voz sintética lê em voz alta como grito.
  const narration = humanizeTone(
    clamp(
      splitSentences(stripMarkdown(section.body)).slice(0, 4).join(' ') || stripMarkdown(section.body),
      620,
    ),
  );
  return {
    narration: narration.length >= 20 ? narration : `Nesta parte, vamos ver ${section.title}.`,
    onScreen: clamp(section.title, 90),
    visual: `Ilustração sobre ${clamp(section.title, 80)}`,
    seconds: estimateSceneSeconds(narration),
  };
}

/**
 * Completa o roteiro até o mínimo de 2 cenas (contrato do player e do schema).
 * Duas cenas curtas contam uma história melhor do que uma cena de um minuto.
 */
function ensureEnoughScenes(scenes: VideoScene[], lessonTitle: string): VideoScene[] {
  const out = [...scenes];
  if (out.length === 0) {
    out.push({
      narration: `Nesta aula vamos estudar ${lessonTitle}. O conteúdo textual completo está na aba de leitura.`,
      onScreen: clamp(lessonTitle, 90),
      visual: 'Título da aula sobre fundo neutro',
      seconds: 10,
    });
  }
  if (out.length === 1) {
    out.push({
      narration: `Para fechar ${lessonTitle}, revise os pontos principais e aplique um deles ainda esta semana.`,
      onScreen: 'Recapitulando',
      visual: 'Lista de pontos-chave aparecendo em sequência',
      seconds: 12,
    });
  }
  return out.slice(0, 10);
}

/** Kit mínimo sempre válido — último recurso, nunca lança. */
function minimalKit(lessonTitle: string): LessonKit {
  const summary = padSummary('', lessonTitle);
  return {
    video: {
      title: clamp(lessonTitle, 80),
      scenes: ensureEnoughScenes([], lessonTitle),
    },
    slides: [
      { title: clamp(lessonTitle, 70), bullets: ['Conteúdo da aula', 'Aplicação prática'] },
    ],
    plain: {
      summary,
      bullets: padBullets([], lessonTitle),
    },
    checkpoint: [],
  };
}

/**
 * Constrói o kit a partir do markdown da aula.
 *
 * O resumo passa por `makePlainLanguage`, então mesmo um texto acadêmico vira
 * leitura curta com métrica medida — não é a IA prometendo simplicidade.
 */
export function deriveKitFromMarkdown(markdown: string, lessonTitle: string): LessonKit {
  try {
    const sections = splitMarkdownSections(markdown, lessonTitle);
    const source =
      sections.length > 0 ? sections : [{ title: lessonTitle, body: stripMarkdown(markdown) }];

    const slides: Slide[] = source.map((section) => {
      const bullets = bulletsFrom(section.body);
      const fallbackBullet = clamp(splitSentences(section.body)[0] ?? '', 140);
      return {
        title: clamp(section.title, 70) || lessonTitle,
        bullets:
          bullets.length > 0
            ? bullets.map((b) => clamp(b, 140))
            : [fallbackBullet.length >= 5 ? fallbackBullet : 'Conteúdo da aula'],
        notes: clamp(stripMarkdown(section.body), 700),
        visual: `Apoio visual: ${clamp(section.title, 60)}`,
      };
    });

    const scenes = ensureEnoughScenes(source.map(sceneFromSection), lessonTitle);

    // Abertura acolhedora na primeira cena: o roteiro derivado é o texto da aula
    // lido em voz alta, e começar direto no conteúdo soa a leitor de tela. Uma
    // frase de entrada muda a sensação de "isto foi feito para mim".
    if (scenes.length > 0 && !/^(vamos|ol[áa]|bem-vind|nesta aula)/i.test(scenes[0].narration)) {
      scenes[0] = {
        ...scenes[0],
        narration: `Vamos ver ${lessonTitle}. ${scenes[0].narration}`.slice(0, 620),
        seconds: Math.min(45, scenes[0].seconds + 2),
      };
    }

    const summarySource =
      splitSentences(stripMarkdown(source[0]?.body ?? markdown)).slice(0, 4).join(' ') ||
      stripMarkdown(markdown);
    const plain = makePlainLanguage(clamp(summarySource, 900) || lessonTitle);

    const candidate = {
      video: { title: clamp(lessonTitle, 80), scenes },
      slides: slides.length > 0 ? slides : [{ title: lessonTitle, bullets: ['Conteúdo da aula'] }],
      plain: {
        summary: humanizeTone(padSummary(plain.text, lessonTitle)),
        bullets: padBullets(
          source.map((s) => clamp(s.title, 120)),
          lessonTitle,
        ).map((bullet) => humanizeTone(bullet)),
        glossary: glossaryFrom(markdown),
      },
      checkpoint: [],
    };

    const parsed = lessonKitSchema.safeParse(candidate);
    return parsed.success ? parsed.data : minimalKit(lessonTitle);
  } catch {
    return minimalKit(lessonTitle);
  }
}

export interface KitMetrics {
  slides: number;
  scenes: number;
  videoSeconds: number;
  checkpointQuestions: number;
  /** palavras do resumo em linguagem simples */
  words: number;
  flesch: number;
  level: string;
  readingMinutes: number;
  /** 0–100: quão próximo de uma pessoa falando (domain/learning/tone.ts) */
  tone: number;
  toneLevel: string;
}

/** Métricas exibidas no admin — o "o que a IA produziu" em números. */
export function kitMetrics(kit: LessonKit): KitMetrics {
  const stats = analyzeReadability(kit.plain.summary);
  const narration = kit.video.scenes.map((scene) => scene.narration).join(' ');
  const tone = analyzeTone(`${narration} ${kit.plain.summary}`);
  const videoSeconds = kit.video.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  return {
    slides: kit.slides.length,
    scenes: kit.video.scenes.length,
    videoSeconds,
    checkpointQuestions: kit.checkpoint.length,
    words: stats.words,
    flesch: stats.flesch,
    level: stats.level,
    readingMinutes: stats.readingMinutes,
    tone: tone.warmth,
    toneLevel: tone.level,
  };
}

/**
 * Normaliza um kit vindo do modelo.
 *
 * Valida CAMPO A CAMPO, não o objeto inteiro: uma questão com `correctIndex`
 * inválido não pode derrubar os slides que vieram certos. O que faltar é
 * completado pela derivação do markdown, e o resumo sempre passa pela
 * simplificação — o modelo não tem como entregar uma aula quebrada nem um
 * texto difícil.
 */
export function normalizeKit(raw: unknown, markdown: string, lessonTitle: string): LessonKit {
  const fallback = deriveKitFromMarkdown(markdown, lessonTitle);
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const slides = (Array.isArray(obj.slides) ? obj.slides : [])
    .map((s) => slideSchema.safeParse(s))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: Slide }).data)
    .filter((s) => s.title.trim().length > 0 && s.bullets.length > 0);

  const videoObj = (obj.video && typeof obj.video === 'object' ? obj.video : {}) as Record<string, unknown>;
  const scenes = (Array.isArray(videoObj.scenes) ? videoObj.scenes : [])
    .map((s) => videoSceneSchema.safeParse(s))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: VideoScene }).data)
    .filter((s) => s.narration.trim().length >= 20);

  const plainParsed = plainTextSchema.safeParse(obj.plain);
  const plain = plainParsed.success ? plainParsed.data : fallback.plain;
  const plainResult = makePlainLanguage(plain.summary || fallback.plain.summary);

  const checkpoint = (Array.isArray(obj.checkpoint) ? obj.checkpoint : [])
    .map((q) => checkpointQuestionSchema.safeParse(q))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: LessonKit['checkpoint'][number] }).data)
    .filter((q) => q.correctIndex < q.options.length)
    .slice(0, 4);

  const videoTitle =
    typeof videoObj.title === 'string' && videoObj.title.trim().length >= 3
      ? videoObj.title
      : fallback.video.title;

  const candidate = {
    video: {
      title: videoTitle,
      // Tom aplicado DEPOIS do modelo: o prompt pede, o código garante.
      scenes: ensureEnoughScenes(scenes, lessonTitle).map((scene) => ({
        ...scene,
        narration: humanizeTone(scene.narration),
      })),
    },
    slides: (slides.length > 0 ? slides : fallback.slides).map((slide) => ({
      ...slide,
      notes: slide.notes ? humanizeTone(slide.notes) : slide.notes,
    })),
    plain: {
      summary: humanizeTone(padSummary(plainResult.text, lessonTitle)),
      bullets: padBullets(plain.bullets, lessonTitle).map((bullet) => humanizeTone(bullet)),
      glossary:
        plain.glossary && plain.glossary.length > 0 ? plain.glossary : fallback.plain.glossary,
    },
    checkpoint: checkpoint.map((question) => ({
      ...question,
      question: humanizeTone(question.question),
      explanation: question.explanation ? humanizeTone(question.explanation) : undefined,
    })),
  };

  const parsed = lessonKitSchema.safeParse(candidate);
  return parsed.success ? parsed.data : fallback;
}

/** Reexporta o schema de vídeo para quem valida roteiro isolado. */
export const lessonVideoValidator = lessonVideoSchema;
