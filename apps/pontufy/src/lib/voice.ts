// ═══════════════════════════════════════════════════════════════════════════
// Voz da videoaula
//
// O `speechSynthesis` do navegador pode soar como leitor de tela — e voz de
// leitor de tela em treinamento obrigatório é o som de "isso não foi feito
// para mim". Três alavancas resolvem a maior parte disso, sem custo e sem
// serviço externo:
//
// 1. ESCOLHER a voz certa. O navegador expõe de 1 a 30 vozes; a padrão quase
//    nunca é a melhor. As neurais ("Natural"/"Neural", do Edge, e as do Google)
//    estão disponíveis na maioria dos Windows e Chrome atuais.
// 2. AJUSTAR a prosódia. Um pouco mais devagar que o padrão e sem pitch
//    artificial lê como gente; o padrão acelerado lê como metrônomo.
// 3. RESPIRAR entre frases. Um texto de 40 segundos em uma única utterance sai
//    sem pausa. Falar frase por frase, com silêncio curto entre elas, é o que
//    mais se aproxima de fala humana.
//
// Tudo aqui é função pura sobre dados — testável sem navegador.
// ═══════════════════════════════════════════════════════════════════════════

export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

export interface RankedVoice<T extends VoiceLike = VoiceLike> {
  voice: T;
  score: number;
  reason: string;
}

/** Vozes que soam a sintetizador de década passada. */
const PENALIZED = /compact|espeak|festival|pico|robot|eloquence|sam\b|albert|zarvox/i;

/** Nomes de voz neural pt-BR mais comuns (Edge/Windows e Chrome). */
const PREFERRED_NAMES =
  /francisca|fernanda|antonio|ant[ôo]nio|luciana|joana|maria|thiago|daniel|helena|vit[óo]ria|google portugu/i;

export function scoreVoice(voice: VoiceLike): RankedVoice {
  const name = voice.name ?? '';
  const lang = (voice.lang ?? '').toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  if (!lang.startsWith('pt')) {
    return { voice, score: -1000, reason: 'não é português' };
  }

  if (PENALIZED.test(name)) {
    score -= 120;
    reasons.push('voz sintética antiga');
  }

  if (/natural|neural/i.test(name)) {
    score += 120;
    reasons.push('neural');
  }
  if (/google/i.test(name)) {
    score += 70;
    reasons.push('Google');
  }
  if (PREFERRED_NAMES.test(name)) {
    score += 50;
    reasons.push('voz pt-BR conhecida');
  }
  // Vozes online são as neurais de verdade no Edge/Windows.
  if (voice.localService === false) {
    score += 25;
    reasons.push('online');
  }
  if (voice.default) {
    score += 5;
    reasons.push('padrão do sistema');
  }
  // pt-BR ganha de pt-PT para conteúdo brasileiro.
  if (lang.includes('br')) {
    score += 20;
    reasons.push('pt-BR');
  }

  return { voice, score, reason: reasons.join(', ') || 'genérica' };
}

export function rankVoices<T extends VoiceLike>(voices: T[]): Array<RankedVoice<T>> {
  return voices
    .map((voice) => scoreVoice(voice) as RankedVoice<T>)
    .filter((item) => item.score > -1000)
    .sort((a, b) => b.score - a.score);
}

export function pickBestVoice<T extends VoiceLike>(voices: T[]): T | null {
  return rankVoices(voices)[0]?.voice ?? null;
}

export interface Prosody {
  rate: number;
  pitch: number;
  volume: number;
}

/**
 * Prosódia por qualidade da voz.
 *
 * Voz neural aceita o ritmo natural (0,98). Voz sintética genérica precisa de
 * ritmo mais lento para o ouvinte processar — e pitch levemente abaixo, que
 * reduz o timbre "de desenho animado".
 */
export function prosodyFor(voice: VoiceLike | null | undefined): Prosody {
  const name = voice?.name ?? '';
  if (!voice) return { rate: 0.92, pitch: 0.97, volume: 1 };
  if (/natural|neural/i.test(name)) return { rate: 0.98, pitch: 1, volume: 1 };
  if (/google/i.test(name)) return { rate: 0.95, pitch: 1, volume: 1 };
  return { rate: 0.9, pitch: 0.96, volume: 1 };
}

/** Abreviações que a voz lê ao pé da letra. */
const SPEECH_FIXES: Array<[RegExp, string]> = [
  [/\bex\.?:/gi, 'por exemplo,'],
  [/\be\.g\.?\b/gi, 'por exemplo'],
  [/\bi\.e\.?\b/gi, 'ou seja'],
  [/\betc\.?\b/gi, 'etcétera'],
  [/\bart\.\s*(\d+)/gi, 'artigo $1'],
  [/\bn[ºo]\.?\s*(\d+)/gi, 'número $1'],
  [/\bR\$\s*/g, 'reais '],
  [/%/g, ' por cento'],
  [/\b&/g, ' e '],
  [/\//g, ' ou '],
  [/\b(a\.?c\.?|a\.?C\.?)\b/g, 'antes de Cristo'],
];

/** Limpa o texto para FALA: sem markdown, sem emoji, sem grito. */
export function speechify(text: string): string {
  let out = (text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/[•●▪◦]/g, ', ')
    .replace(/[—–]/g, ', ')
    // Emoji não é falado e pode virar "carinha sorrindo".
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [pattern, replacement] of SPEECH_FIXES) out = out.replace(pattern, replacement);

  // Voz sintética não expressa entusiasmo: exclamação vira ponto.
  out = out.replace(/!/g, '.').replace(/\.{2,}/g, '.');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Divide a narração em falas curtas, para o player respirar entre elas.
 *
 * Agrupa frases até `maxChars` (padrão 180 ≈ 12 s de fala) e, se uma frase
 * sozinha for maior, quebra nas vírgulas — nunca no meio de uma palavra.
 */
export function chunkNarration(text: string, maxChars = 180): string[] {
  const clean = speechify(text);
  if (!clean) return [];

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      push();
      // Quebra em vírgula, acumulando até o teto.
      for (const part of sentence.split(/,\s+/)) {
        const candidate = current ? `${current}, ${part}` : part;
        if (candidate.length > maxChars && current) {
          push();
          current = part;
        } else {
          current = candidate;
        }
      }
      push();
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars && current) {
      push();
      current = sentence;
    } else {
      current = candidate;
    }
  }
  push();

  return chunks;
}

/** Silêncio entre falas: curto dentro da cena, longo ao trocar de ideia. */
export function pauseAfter(fragment: string): number {
  if (/[.!?]$/.test(fragment)) return 260;
  return 160;
}

export interface VoiceDiagnostics {
  available: number;
  chosen: string | null;
  chosenReason: string | null;
  neural: boolean;
}

/** Diagnóstico curto para a UI: "voz neural" ou "voz do sistema". */
export function describeVoice(voices: VoiceLike[]): VoiceDiagnostics {
  const ranked = rankVoices(voices);
  const best = ranked[0];
  return {
    available: voices.length,
    chosen: best?.voice.name ?? null,
    chosenReason: best?.reason ?? null,
    neural: !!best && /natural|neural/i.test(best.voice.name),
  };
}
