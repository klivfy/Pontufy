// ═══════════════════════════════════════════════════════════════════════════
// Tom de voz do curso
//
// Treinamento obrigatório já chega com resistência. Se o texto fala como um
// edital ("cumpre informar que os colaboradores deverão..."), o colaborador
// desliga antes da segunda aula — e a voz sintética, se for robótica, fecha a
// porta. Este módulo mede e corrige a parte escrita; a voz fica em
// `lib/voice.ts`.
//
// A régua é explícita e testável: formalidade, passiva, grito (caixa alta,
// exclamação) e ausência de "você" derrubam a nota. O mesmo texto sempre
// produz a mesma nota e a mesma reescrita — nada de "parece mais humano".
// ═══════════════════════════════════════════════════════════════════════════

export interface ToneStats {
  /** 0–100; maior = mais próximo de uma pessoa falando. */
  warmth: number;
  formalityMarkers: string[];
  passiveCount: number;
  allCapsWords: string[];
  exclamations: number;
  /** true quando o texto trata o leitor por "você". */
  addressesReader: boolean;
  level: 'acolhedor' | 'neutro' | 'formal' | 'burocratico';
}

const FORMALITY: Array<[RegExp, string]> = [
  [/\bprezad[oa]s?\s*(?:\(a\))?\s*colaborador(?:a|es|as)?\b/gi, 'prezado colaborador'],
  [/\bcar[oa]\s*colaborador(?:a)?\b/gi, 'caro colaborador'],
  [/\bcumpre\s+(?:informar|destacar|salientar|ressaltar)\b/gi, 'cumpre informar'],
  [/\bfaz-se\s+necess[áa]rio\b/gi, 'faz-se necessário'],
  [/\bdestarte\b/gi, 'destarte'],
  [/\boutrossim\b/gi, 'outrossim'],
  [/\bno\s+que\s+tange\b/gi, 'no que tange'],
  [/\bdoravante\b/gi, 'doravante'],
  [/\bvossa\s+senhoria\b/gi, 'vossa senhoria'],
  [/\bsalientamos\s+que\b/gi, 'salientamos que'],
  [/\binformamos\s+que\b/gi, 'informamos que'],
  [/\bsegue\s+abaixo\b/gi, 'segue abaixo'],
  [/\bem\s+anexo\b/gi, 'em anexo'],
  [/\bsolicitamos\s+que\b/gi, 'solicitamos que'],
];

/**
 * Voz passiva ("foi validado", "deve ser aprovado").
 *
 * O `{2,}` antes do sufixo é proposital: sem ele, "é dado pessoal" contava como
 * passiva — "d" + "ado" — e o texto perdia pontos por usar a palavra "dado",
 * que é o assunto da aula. Falso positivo em métrica de qualidade é pior que
 * métrica nenhuma.
 */
const PASSIVE_RE =
  /\b(?:foi|foram|ser[áa]o?|deve[m]?\s+ser|é|são)\s+[a-záàâãéêíóôõúü]{2,}\s*(?:ado|ada|ados|adas|ido|ida|idos|idas)\b/gi;

/** Siglas que NÃO devem ser "desgritadas" (mantêm caixa alta). */
const KNOWN_ACRONYMS = new Set([
  'LGPD', 'GDPR', 'RH', 'TI', 'DPO', 'EPI', 'EPC', 'CPF', 'CNPJ', 'CEO', 'CFO',
  'CTO', 'IA', 'API', 'SaaS', 'B2B', 'B2C', 'PIX', 'CRM', 'ERP', 'NR', 'SST',
  'PGR', 'PCMSO', 'LTDA', 'MEI', 'RG', 'CNH', 'INSS', 'FGTS', 'CLT', 'PJ',
  'URL', 'PDF', 'CSV', 'GPS', 'LMS', 'OK', 'SLA', 'KPI', 'ROI', 'ESG',
]);

const ALL_CAPS_RE = /\b[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]{3,}\b/g;

/**
 * Imperativo de 2ª pessoa usado em treinamento ("escolha", "envie", "verifique").
 *
 * Sem isto, a régua penalizava justamente o texto bom: "Envie só as colunas que
 * a outra área precisa" fala com o leitor e era classificada como impessoal,
 * porque não tem a palavra "você". Não é um tagger de POS — é a lista fechada
 * de verbos que aparecem em instrução corporativa, o que basta para medir.
 */
const IMPERATIVE_RE = new RegExp(
  `(?:^|[.!?]\\s+|,\\s+)(${[
    'escolha', 'envie', 'use', 'verifique', 'confira', 'evite', 'lembre', 'prefira',
    'guarde', 'avise', 'fale', 'compartilhe', 'acesse', 'mantenha', 'revise', 'cheque',
    'anote', 'separe', 'troque', 'ative', 'desative', 'configure', 'preencha', 'assine',
    'leia', 'veja', 'consulte', 'comece', 'pense', 'imagine', 'pergunte', 'pare',
    'confie', 'proteja', 'respeite', 'cuide', 'trate', 'valide', 'teste', 'pratique',
    'estude', 'anexe', 'apague', 'baixe', 'instale', 'atualize', 'registre', 'solicite',
  ].join('|')})(?=[^\\p{L}]|$)`,
  'iu',
);

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export function analyzeTone(text: string): ToneStats {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) {
    return {
      warmth: 0,
      formalityMarkers: [],
      passiveCount: 0,
      allCapsWords: [],
      exclamations: 0,
      addressesReader: false,
      level: 'burocratico',
    };
  }

  const formalityMarkers = FORMALITY.filter(([re]) => {
    re.lastIndex = 0;
    return re.test(clean);
  }).map(([re]) => {
    re.lastIndex = 0;
    return (clean.match(re) ?? [''])[0].toLowerCase();
  });

  const passiveCount = countMatches(clean, PASSIVE_RE);
  const allCapsWords = (clean.match(ALL_CAPS_RE) ?? []).filter(
    (word) => !KNOWN_ACRONYMS.has(word.toUpperCase()),
  );
  const exclamations = countMatches(clean, /!/g);
  // `\b` não serve aqui: em JS é fronteira ASCII, e "você"/"olá" terminam em
  // letra acentuada — o `\b` final nunca casa e o texto acolhedor era lido como
  // impessoal (bug pego pelo teste: 63 em vez de 75).
  const WORD_EDGE = (body: string) => new RegExp(`(?:^|[^\\p{L}])(${body})(?=[^\\p{L}]|$)`, 'iu');
  const hasPronoun = WORD_EDGE('voc[êe]s?|seu|sua|teu|tua').test(clean);
  const hasImperative = IMPERATIVE_RE.test(clean);
  const addressesReader = hasPronoun || hasImperative;

  let warmth = 62;
  warmth -= formalityMarkers.length * 9;
  warmth -= Math.min(passiveCount, 8) * 2.5;
  warmth -= Math.min(allCapsWords.length, 6) * 4;
  warmth -= Math.min(exclamations, 5) * 3;
  // Endereçamento implícito ("envie", "confira") conta, mas vale menos que o
  // "você" explícito.
  if (!addressesReader) warmth -= 12;
  else if (!hasPronoun) warmth -= 4;
  if (WORD_EDGE('ol[áa]|oi|bem-vind[oa]?s?|vamos|vem comigo|bora').test(clean)) warmth += 10;
  if (WORD_EDGE('obrigad[oa]|parab[ée]ns|conte comigo|estou aqui').test(clean)) warmth += 6;

  const final = Math.max(0, Math.min(100, Math.round(warmth)));
  return {
    warmth: final,
    formalityMarkers,
    passiveCount,
    allCapsWords,
    exclamations,
    addressesReader,
    level:
      final >= 75 ? 'acolhedor' : final >= 55 ? 'neutro' : final >= 35 ? 'formal' : 'burocratico',
  };
}

/**
 * Substituições de tom — diretas, sem IA.
 *
 * Cada regra é conservadora de propósito: reescrever "os colaboradores" para
 * "você" no meio de uma explicação técnica produz frase sem sujeito. Só troca
 * onde o sentido é inequívoco.
 */
const TONE_RULES: Array<[RegExp, string]> = [
  [/\bprezad[oa]s?\s*(?:\(a\))?\s*colaborador(?:a|es|as)?\b/gi, 'Olá'],
  [/\bcar[oa]\s*colaborador(?:a)?\b/gi, 'Olá'],
  [/\bcumpre\s+informar\s+que\b/gi, 'é importante dizer que'],
  [/\bcumpre\s+destacar\s+que\b/gi, 'vale destacar que'],
  [/\bcumpre\s+salientar\s+que\b/gi, 'vale lembrar que'],
  [/\bfaz-se\s+necess[áa]rio\s+que\b/gi, 'é preciso que'],
  [/\bfaz-se\s+necess[áa]rio\b/gi, 'é preciso'],
  [/\bdestarte\b/gi, 'então'],
  [/\boutrossim\b/gi, 'além disso'],
  [/\bno\s+que\s+tange\s+a\b/gi, 'sobre'],
  [/\bno\s+que\s+tange\b/gi, 'sobre'],
  [/\bdoravante\b/gi, 'a partir de agora'],
  [/\bvossa\s+senhoria\b/gi, 'você'],
  [/\bsalientamos\s+que\b/gi, 'lembre-se de que'],
  [/\binformamos\s+que\b/gi, 'aviso:'],
  [/\bsolicitamos\s+que\s+os\s+colaboradores\b/gi, 'pedimos que você'],
  [/\bos\s+colaboradores\s+dever[ãa]o\b/gi, 'você deve'],
  [/\bos\s+colaboradores\s+devem\b/gi, 'você deve'],
  [/\bo\s+colaborador\s+dever[áa]\b/gi, 'você deve'],
  [/\bo\s+colaborador\s+deve\b/gi, 'você deve'],
  [/\bos\s+colaboradores\s+precisam\b/gi, 'você precisa'],
  [/\bé\s+vedado\b/gi, 'não é permitido'],
  [/\bfica\s+vedado\b/gi, 'não é permitido'],
  [/\bem\s+anexo\s+segue\b/gi, 'segue'],
  [/\bsegue\s+abaixo\b/gi, 'aqui está'],
];

/**
 * Deixa o texto mais próximo de uma pessoa falando.
 *
 * Ordem importa: primeiro o vocabulário, depois a caixa, por último a
 * pontuação. A pontuação final controla as pausas da voz sintética — uma
 * exclamação lida em voz alta soa a alarme.
 */
export function humanizeTone(text: string): string {
  let out = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!out) return '';

  // `aviso:` no meio de frase fica estranho em maiúscula; normaliza para minúscula.
  out = out.replace(/\baviso:\s*/g, 'aviso: ');

  for (const [pattern, replacement] of TONE_RULES) {
    out = out.replace(pattern, replacement);
  }

  // Grito: caixa alta em palavra comum. Siglas conhecidas ficam intactas.
  out = out.replace(ALL_CAPS_RE, (word) => {
    if (KNOWN_ACRONYMS.has(word.toUpperCase())) return word;
    const lower = word.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });

  // Exclamação vira ponto — uma no fim sobrevive, várias não.
  out = out.replace(/!{2,}/g, '.');
  out = out.replace(/([.!?])\s*!/g, '$1');
  out = out.replace(/\s*!\s*/g, '! ');

  // Travessão lido em voz alta vira "traço"; vírgula vira pausa natural.
  out = out.replace(/\s+[—–]\s+/g, ', ');

  // Espaço duplo e pontuação órfã.
  out = out
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:])(?=\S)/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Garante início de frase em maiúscula.
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Aplica o tom e devolve as métricas antes/depois — usado no admin. */
export function refineTone(text: string): {
  text: string;
  before: ToneStats;
  after: ToneStats;
} {
  const before = analyzeTone(text);
  const humanized = humanizeTone(text);
  return { text: humanized, before, after: analyzeTone(humanized) };
}
