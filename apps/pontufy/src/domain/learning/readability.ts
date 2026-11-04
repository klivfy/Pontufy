// ═══════════════════════════════════════════════════════════════════════════
// Legibilidade (pt-BR)
//
// O pedido "textos de fácil leitura" não pode ser uma instrução no prompt e
// uma reza. Prompt é sugestão: o modelo entrega o que quiser. Aqui o texto é
// MEDIDO — e o número vira gate: se a versão fácil não passar do alvo, ela é
// reescrita de forma determinística antes de chegar ao colaborador.
//
// Fórmula: Flesch adaptada ao português (Martins et al.), a mesma usada em
// avaliação de materiais didáticos brasileiros:
//
//   Flesch(pt) = 248.835 − 1.015 × (palavras/frases) − 84.6 × (sílabas/palavras)
//
// Quanto maior, mais fácil. Não é uma medida de verdade — é um detector de
// "parágrafo de 6 linhas com vocabulário de edital", que é o que cansa quem
// faz treinamento obrigatório no meio do expediente.
// ═══════════════════════════════════════════════════════════════════════════

export type ReadabilityLevel =
  | 'muito-facil'
  | 'facil'
  | 'medio'
  | 'dificil'
  | 'muito-dificil';

export interface ReadabilityStats {
  words: number;
  sentences: number;
  syllables: number;
  /** palavras por frase */
  avgWordsPerSentence: number;
  /** sílabas por palavra */
  avgSyllablesPerWord: number;
  /** 0–100; maior = mais fácil */
  flesch: number;
  level: ReadabilityLevel;
  /** tempo de leitura em minutos (200 palavras/min) */
  readingMinutes: number;
}

/** Remove marcação Markdown para medir só o que o leitor vê. */
export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Conta sílabas por grupos de vogais.
 *
 * Aproximação suficiente para medir legibilidade: encontros vocálicos viram um
 * grupo (ditongo), o que subestima hiato ("sa-í-da") em uma sílaba. O erro é
 * sistemático e pequeno — e a fórmula só precisa ser comparável consigo mesma.
 */
export function countSyllables(word: string): number {
  const clean = word
    .toLowerCase()
    .replace(/[^a-záàâãéêíóôõúüç]/g, '');
  if (!clean) return 0;

  // `qu`/`gu` antes de e/i com consoante depois: o "u" não é pronunciado
  // (quin-ta, gui-tar-ra). Quando a vogal seguinte é outra vogal (gui-a), o "u"
  // pertence ao encontro e não pode ser descartado.
  const normalized = clean.replace(/([qg])u([ei])(?![aeiouáàâãéêíóôõúü])/g, '$1$2');

  const groups = normalized.match(/[aeiouáàâãéêíóôõúü]+/g);
  const count = groups ? groups.length : 0;
  return Math.max(1, count);
}

/** Divide em frases. Abreviações comuns não encerram frase. */
export function splitSentences(text: string): string[] {
  const clean = stripMarkdown(text);
  if (!clean) return [];
  const guarded = clean
    .replace(/\b(e\.g|i\.e|etc|vs|Sr|Sra|Dr|Dra|Prof|nº|art|pág)\./gi, '$1<DOT>')
    .replace(/\b(\d)\.(\d)/g, '$1<DOT>$2');

  return guarded
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.replace(/<DOT>/g, '.').trim())
    .filter((s) => s.length > 0);
}

function words(text: string): string[] {
  const clean = stripMarkdown(text);
  if (!clean) return [];
  return clean
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w.length > 0);
}

export function levelFromFlesch(score: number): ReadabilityLevel {
  if (score >= 75) return 'muito-facil';
  if (score >= 60) return 'facil';
  if (score >= 50) return 'medio';
  if (score >= 35) return 'dificil';
  return 'muito-dificil';
}

export function analyzeReadability(text: string): ReadabilityStats {
  const ws = words(text);
  const sentences = splitSentences(text);
  const sentenceCount = Math.max(1, sentences.length);
  const wordCount = ws.length;

  if (wordCount === 0) {
    return {
      words: 0,
      sentences: 0,
      syllables: 0,
      avgWordsPerSentence: 0,
      avgSyllablesPerWord: 0,
      flesch: 0,
      level: 'muito-dificil',
      readingMinutes: 0,
    };
  }

  const syllables = ws.reduce((sum, w) => sum + countSyllables(w), 0);
  const asl = wordCount / sentenceCount;
  const asw = syllables / wordCount;
  const flesch = Math.max(0, Math.min(100, 248.835 - 1.015 * asl - 84.6 * asw));

  return {
    words: wordCount,
    sentences: sentences.length,
    syllables,
    avgWordsPerSentence: Number(asl.toFixed(1)),
    avgSyllablesPerWord: Number(asw.toFixed(2)),
    flesch: Number(flesch.toFixed(1)),
    level: levelFromFlesch(flesch),
    readingMinutes: Number((wordCount / 200).toFixed(1)),
  };
}

// ── Simplificação determinística ───────────────────────────────────────────
// Não é IA: é cirurgia de frase. Roda depois da geração e serve também para
// curso legado (que nunca passou pelo prompt novo).

const VERBOSE: Array<[RegExp, string]> = [
  [/\bcom o objetivo de\b/gi, 'para'],
  [/\bcom a finalidade de\b/gi, 'para'],
  [/\bdevido ao fato de que\b/gi, 'porque'],
  [/\bno que se refere a\b/gi, 'sobre'],
  [/\bcom relação a\b/gi, 'sobre'],
  [/\ba respeito de\b/gi, 'sobre'],
  [/\bpor meio de\b/gi, 'com'],
  [/\bpor intermédio de\b/gi, 'com'],
  [/\bde forma que\b/gi, 'assim'],
  [/\bde modo que\b/gi, 'assim'],
  [/\bé necessário que\b/gi, 'precisa'],
  [/\bfaz-se necessário\b/gi, 'é preciso'],
  [/\bposteriormente\b/gi, 'depois'],
  [/\banteriormente\b/gi, 'antes'],
  [/\badicionalmente\b/gi, 'além disso'],
  [/\bentretanto\b/gi, 'mas'],
  [/\bcontudo\b/gi, 'mas'],
  [/\btodavia\b/gi, 'mas'],
  [/\bno entanto\b/gi, 'mas'],
  [/\bportanto\b/gi, 'então'],
  [/\bdessa forma\b/gi, 'assim'],
  [/\bdesa forma\b/gi, 'assim'],
  [/\brealizar\b/gi, 'fazer'],
  [/\brealiza\b/gi, 'faz'],
  [/\butilizar\b/gi, 'usar'],
  [/\butiliza\b/gi, 'usa'],
  [/\bpossibilitar\b/gi, 'permitir'],
  [/\bnecessário\b/gi, 'preciso'],
  [/\beventual\b/gi, 'possível'],
];

/**
 * Quebra frases longas em vírgulas/conjunções, sem virar robô.
 *
 * O primeiro corte era `split(/,\s+/)` puro — e "coleta, tratamento e
 * armazenamento" virava três frases, com maiúscula no meio da enumeração.
 * Agora o corte em vírgula exige conjunção depois dela, e o corte por tamanho
 * só acontece quando o pedaço restante ainda é uma oração de verdade.
 */
function shortenSentences(text: string, maxWords = 20): string {
  return splitSentences(text)
    .flatMap((sentence) => {
      if (words(sentence).length <= maxWords) return [sentence];

      const byConjunction = sentence
        .split(/;\s+/)
        .flatMap((chunk) =>
          chunk.split(/,\s+(?=(?:e|mas|que|porque|então|já que|onde|quando|porém|pois|portanto)\s)/i),
        );

      const byLength = byConjunction.flatMap((chunk) => {
        if (words(chunk).length <= maxWords + 6) return [chunk];
        const parts = chunk.split(/,\s+(?=\S)/);
        // Se algum pedaço for curto demais, o corte em vírgula está quebrando
        // enumeração ("coleta, tratamento, armazenamento") — e cortar ali
        // perderia palavra. Nesse caso, mantém a frase inteira.
        if (parts.some((part) => words(part).length < 5)) return [chunk];
        return parts;
      });

      return byLength
        .map((part, i) => {
          const trimmed = part.trim().replace(/[,;]$/, '');
          if (!trimmed) return '';
          // Nada de forçar maiúscula: o pedaço pode ser continuação de uma
          // enumeração ("... coleta, tratamento"). Capitalizar aqui produzia
          // "Coleta Tratamento Armazenamento" no meio da frase.
          const needsDot = i === byLength.length - 1 ? /[.!?…]$/.test(trimmed) : true;
          return needsDot ? trimmed : `${trimmed}.`;
        })
        .filter(Boolean);
    })
    .join(' ');
}

/**
 * Deixa o texto legível: remove jargão de ofício, quebra frase longa e garante
 * ponto final. Determinístico — o mesmo texto sempre vira o mesmo resultado,
 * então dá para testar.
 */
export function simplifyToPlainLanguage(text: string, maxWordsPerSentence = 20): string {
  let out = stripMarkdown(text);
  for (const [pattern, replacement] of VERBOSE) out = out.replace(pattern, replacement);
  out = shortenSentences(out, maxWordsPerSentence);
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Versão "fácil" com garantia: tenta simplificar até 3 vezes encurtando o teto
 * de palavras por frase; retorna o melhor resultado obtido e a métrica final.
 */
export function makePlainLanguage(
  text: string,
  targetFlesch = 60,
): { text: string; stats: ReadabilityStats; attempts: number } {
  let best = simplifyToPlainLanguage(text);
  let bestStats = analyzeReadability(best);
  let attempts = 1;

  // Escada de tetos: 16 é confortável para leitura adulta; 10 é o limite em que
  // a frase ainda tem sujeito e predicado. Descer até 10 é o que faz um resumo
  // com frases de 25 palavras realmente virar "leitura fácil" — o modelo não
  // obedece ao "máximo de 20 palavras" do prompt, então o corte é aqui.
  for (const cap of [16, 14, 12, 10]) {
    if (bestStats.flesch >= targetFlesch) break;
    const candidate = simplifyToPlainLanguage(text, cap);
    const stats = analyzeReadability(candidate);
    attempts++;
    if (stats.flesch > bestStats.flesch) {
      best = candidate;
      bestStats = stats;
    }
  }

  return { text: best, stats: bestStats, attempts };
}
