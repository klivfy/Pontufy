import { quizModulesSchema } from '@/schemas/quiz';

// ═══════════════════════════════════════════════════════════════════════════
// Quiz dinâmico — sorteio determinístico por semente
//
// Antes, toda tentativa mostrava exatamente as mesmas questões na mesma ordem:
// bastava o colaborador decorar a sequência para "passar". E quem refazia o
// quiz depois de reprovar recebia o mesmo conjunto, sem nenhum ajuste.
//
// Agora cada tentativa recebe:
//   - um SUBCONJUNTO do banco (quando há questões suficientes);
//   - uma MISTURA de dificuldades calibrada pelo número da tentativa
//     (a primeira é equilibrada; quem reprovou recebe mais fáceis; quem já
//     passou e está refazendo recebe mais difíceis);
//   - ordem embaralhada.
//
// A semente é escolhida no cliente, mas a SELEÇÃO é refeita no servidor a
// partir dela — o cliente não escolhe as perguntas, só o "sorteio". Sem isso,
// um cliente mal-intencionado poderia pedir apenas as fáceis, ou responder
// somente uma pergunta e ser aprovado com 100%.
// ═══════════════════════════════════════════════════════════════════════════

export type Difficulty = 'facil' | 'medio' | 'dificil';

export interface PublicQuestion {
  id: string;
  question: string;
  options: string[];
}

/** Hash estável (FNV-1a) — mesma semente, mesma prova, em qualquer processo. */
function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** PRNG pequeno e determinístico (mulberry32). */
function createRandom(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Quantas questões sortear.
 *
 * Banco pequeno vai inteiro: um quiz de 4 questões sorteando 2 faria o
 * colaborador estudar metade do conteúdo. A partir de 8, sortear 60% mantém a
 * prova curta o suficiente para ser respondida no celular.
 */
export function selectionCount(bankSize: number, attemptNumber = 1): number {
  if (bankSize <= 6) return bankSize;
  const base = Math.round(bankSize * 0.6);
  const floor = Math.min(5, bankSize);
  const ceiling = Math.min(12, bankSize);
  // Repetição da prova pede prova um pouco menor — já há histórico.
  const size = attemptNumber >= 2 ? base - 1 : base;
  return Math.max(floor, Math.min(ceiling, size));
}

/** Mistura de dificuldades por tentativa. Somas normalizadas depois. */
export function difficultyMix(attemptNumber = 1): Record<Difficulty, number> {
  if (attemptNumber <= 1) return { facil: 0.3, medio: 0.45, dificil: 0.25 };
  if (attemptNumber === 2) return { facil: 0.5, medio: 0.4, dificil: 0.1 };
  return { facil: 0.2, medio: 0.4, dificil: 0.4 };
}

interface BankQuestion extends PublicQuestion {
  correctIndex: number;
  difficulty?: Difficulty;
  explanation?: string;
  moduleName: string;
}

/** Achata o JSON persistido em um banco de questões com id. */
export function readQuestionBank(value: unknown): BankQuestion[] {
  const parsed = quizModulesSchema.safeParse(value);
  if (!parsed.success) return [];

  const bank: BankQuestion[] = [];
  for (const mod of parsed.data) {
    mod.questions.forEach((question, index) => {
      const id = question.id ?? `${mod.module}#${index}`;
      bank.push({
        id,
        question: question.question,
        options: question.options.map((option) => option.text),
        correctIndex: question.correctIndex,
        difficulty: question.difficulty,
        explanation: question.explanation,
        moduleName: mod.module,
      });
    });
  }
  return bank;
}

/**
 * Sorteia as questões da tentativa.
 *
 * Estratégia: embaralha uma vez com a semente, distribui por dificuldade e
 * preenche as cotas. Se o banco não tiver dificuldade declarada (curso antigo),
 * a cota vira preenchimento livre — nunca devolve menos do que o pedido, a não
 * ser que o banco todo seja menor.
 */
export function selectQuestions(bank: BankQuestion[], seed: string, attemptNumber = 1): BankQuestion[] {
  if (bank.length === 0) return [];

  const random = createRandom(seed);
  const shuffled = shuffle(bank, random);
  const total = selectionCount(bank.length, attemptNumber);

  const buckets: Record<Difficulty, BankQuestion[]> = {
    facil: shuffled.filter((q) => q.difficulty === 'facil'),
    medio: shuffled.filter((q) => q.difficulty === 'medio'),
    dificil: shuffled.filter((q) => q.difficulty === 'dificil'),
  };
  const untagged = shuffled.filter((q) => !q.difficulty);

  const mix = difficultyMix(attemptNumber);
  const picked: BankQuestion[] = [];
  const used = new Set<string>();

  for (const level of ['facil', 'medio', 'dificil'] as Difficulty[]) {
    const quota = Math.round(total * mix[level]);
    for (const question of buckets[level].slice(0, quota)) {
      if (picked.length >= total) break;
      picked.push(question);
      used.add(question.id);
    }
  }

  // Completa com o que sobrou, preservando a ordem embaralhada.
  for (const question of [...shuffled, ...untagged]) {
    if (picked.length >= total) break;
    if (used.has(question.id)) continue;
    picked.push(question);
    used.add(question.id);
  }

  return shuffle(picked, random).slice(0, total);
}

export interface QuizSelection {
  seed: string;
  attemptNumber: number;
  questions: PublicQuestion[];
}

/** Seleção pública (sem gabarito) — é o que vai para o cliente. */
export function buildQuizSelection(
  quizJson: unknown,
  seed: string,
  attemptNumber = 1,
): QuizSelection {
  const bank = readQuestionBank(quizJson);
  const selected = selectQuestions(bank, seed, attemptNumber);
  return {
    seed,
    attemptNumber,
    questions: selected.map((q) => ({ id: q.id, question: q.question, options: q.options })),
  };
}

export interface GradeResult {
  score: number;
  total: number;
  passed: boolean;
  perQuestion: Array<{ id: string; correct: boolean; correctIndex: number; explanation?: string }>;
}

/**
 * Corrige a tentativa sobre o conjunto RECOMPOSTO no servidor.
 *
 * `answers` chega como `{ [questionId]: optionIndex }`. Questão não respondida
 * conta como erro; resposta de questão que não está no sorteio é ignorada.
 */
export function gradeSelection(
  quizJson: unknown,
  seed: string,
  attemptNumber: number,
  answers: Record<string, unknown>,
  minPercentage = 0.7,
): GradeResult {
  const bank = readQuestionBank(quizJson);
  const selected = selectQuestions(bank, seed, attemptNumber);

  const perQuestion = selected.map((question) => {
    const raw = answers?.[question.id];
    const chosen = typeof raw === 'number' && Number.isInteger(raw) ? raw : -1;
    return {
      id: question.id,
      correct: chosen === question.correctIndex,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
    };
  });

  const total = perQuestion.length;
  const score = perQuestion.filter((q) => q.correct).length;
  return {
    score,
    total,
    passed: total > 0 && score / total >= minPercentage,
    perQuestion,
  };
}
