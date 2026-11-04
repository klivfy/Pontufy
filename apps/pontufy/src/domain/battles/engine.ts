import { z } from 'zod';
import { generateObject } from 'ai';
import { getTenantDb } from '@/infra/db';
import { DomainError } from '@/domain/auth';
import { creditDepartmentPoints } from '@/domain/engagement/ranking';
import { notifyBattleChallenge, notifyBattleResult } from '@/lib/notifications';
import { buildProviderChain } from '@/lib/ai-providers';
import { battleQuestionsSchema, parseBattleQuestions } from '@/schemas/quiz';

export const BATTLE_POINTS_PER_CORRECT = 5;

// ═══════════════════════════════════════════════════════════════════════════
// TAREFA 13 — Batalhas de Conhecimento
//  • 13.1: 5 perguntas geradas por IA sobre a trilha da empresa (fallback
//    determinístico local se nenhum provedor estiver configurado).
//  • 13.4: cronômetro estrito de 15s POR QUESTÃO — o servidor re-scora as
//    respostas e rejeita turnos cujo tempo exceda 5×15s (tolerância de
//    rede 5s/questão). Perda de foco é reportada pelo cliente e anula o turno.
// ═══════════════════════════════════════════════════════════════════════════

export const BATTLE_QUESTIONS = 5;
export const QUESTION_TIME_LIMIT_SECONDS = 15;
// Tolerância total para latência de rede/UI (5s extras por questão).
export const TURN_TIME_LIMIT_SECONDS = BATTLE_QUESTIONS * (QUESTION_TIME_LIMIT_SECONDS + 5);
export const BATTLE_TTL_HOURS = 72;

const battleQuestionSchema = z.object({
  question: z.string().min(10),
  options: z.array(z.string().min(1)).min(3).max(5),
  correctIndex: z.number().int().min(0).max(4),
});

export const battleSchema = z.object({
  questions: z.array(battleQuestionSchema).length(BATTLE_QUESTIONS),
});

export type BattleQuestion = z.infer<typeof battleQuestionSchema>;

// ── Geração de questões (IA com fallback local) ────────────────────────────

function localFallbackQuestions(topic: string): BattleQuestion[] {
  const base = [
    {
      question: `Qual é o principal objetivo dos treinamentos de ${topic} na nossa empresa?`,
      options: ['Aplicar o conteúdo no dia a dia de trabalho', 'Cumprir carga horária obrigatória', 'Apenas ganhar pontos', 'Preencher relatórios do RH'],
      correctIndex: 0,
    },
    {
      question: 'Como a Pontufy recompensa a conclusão de aulas?',
      options: ['Com pontos convertíveis em benefícios', 'Com folga remunerada', 'Com aumento salarial automático', 'Com certificado físico'],
      correctIndex: 0,
    },
    {
      question: 'O que acontece com um quiz aprovado abaixo de 70%?',
      options: ['Você pode refazer até passar', 'O curso é bloqueado permanentemente', 'Seus pontos são cancelados', 'Nada, a nota é ignorada'],
      correctIndex: 0,
    },
    {
      question: 'Qual o prazo de validade dos pontos ganhos?',
      options: ['Verifique as regras da sua empresa na Carteira', 'Eles expiram em 24 horas', 'Nunca expiram', 'Expiração apenas em viagem'],
      correctIndex: 0,
    },
    {
      question: 'Onde você consulta o histórico completo de pontos?',
      options: ['Na seção Carteira', 'No menu de configurações', 'No certificado do curso', 'No perfil do líder'],
      correctIndex: 0,
    },
  ];
  return base.slice(0, BATTLE_QUESTIONS);
}

export async function generateBattleQuestions(
  tenantId: string,
  topics: string[],
): Promise<BattleQuestion[]> {
  const chain = buildProviderChain();
  const topicText = topics.length > 0 ? topics.slice(0, 8).join(', ') : 'conteúdos corporativos';

  const userPrompt =
    `Gere exatamente ${BATTLE_QUESTIONS} perguntas de múltipla escolha (4 opções, uma correta) ` +
    `sobre os treinamentos da empresa abordando: ${topicText}. ` +
    `As perguntas devem ser objetivas, do domínio corporativo e sem ambiguidade.`;

  for (const attempt of chain) {
    try {
      const { object } = await generateObject({
        model: attempt.build(),
        schema: battleSchema,
        system:
          'Você é o examinador de conhecimento corporativo da Pontufy. ' +
          'Gere perguntas factuais e verificáveis, em português, com uma única resposta correta.',
        prompt: userPrompt,
        temperature: 0.7,
        maxRetries: 1,
        maxOutputTokens: 1200,
      });
      return object.questions;
    } catch (err) {
      console.warn(`[battles] Geração de questões falhou em ${attempt.name}:`, err);
    }
  }

  console.warn('[battles] Sem provedor de IA — usando questões locais determinísticas.');
  return localFallbackQuestions(topicText);
}

// ── Ciclo de vida do duelo ─────────────────────────────────────────────────

export interface BattleTurnInput {
  answers: number[];      // índice escolhido por questão (server-side re-score)
  elapsedSeconds: number; // tempo total do turno (anti-trapaça)
  focusLost: boolean;     // 13.4 — perda de foco na janela anula o turno
}

export interface BattleTurnResult {
  score: number;
  correct: boolean[];
  completed: boolean;
  winnerId: string | null;
  forfeited: boolean;
}

export function scoreBattleTurn(questions: BattleQuestion[], answers: number[]): boolean[] {
  return questions.map((q, i) => {
    const chosen = answers[i];
    return Number.isInteger(chosen) && chosen === q.correctIndex;
  });
}

/**
 * A3 — tópicos de um duelo a partir das questões persistidas.
 *
 * Antes recebia string e fazia `JSON.parse`. Agora o campo é `jsonb`: a
 * validação de contrato vem do `parseBattleQuestions`, que devolve [] para
 * dado antigo/inválido em vez de estourar no meio de uma partida.
 */
export function battlesTopicsFrom(questionsJson: unknown): string[] {
  return parseBattleQuestions(questionsJson).map((question) => question.question.slice(0, 60));
}

// Converte títulos de cursos em tópicos seguros para o prompt.
export function safeTopics(courseTitles: string[]): string[] {
  return courseTitles.filter((t) => t && t.length > 2).slice(0, 8);
}

export async function getTenantCourseTitles(tenantId: string): Promise<string[]> {
  const db = getTenantDb(tenantId);
  const courses = await db.course.findMany({
    where: { status: 'published' },
    select: { title: true },
    take: 20,
  });
  return courses.map((c: { title: string }) => c.title);
}

export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * A3 — questões de um duelo, validadas e convertidas para a forma em memória.
 *
 * O banco guarda a forma canônica (`options: [{ text }]`, a mesma do quiz de
 * curso). O motor trabalha com `string[]` porque é o que o prompt e o sorteio
 * usam; a conversão acontece aqui, no único ponto de leitura.
 */

/** Forma canônica gravada em `Battle.questionsJson` (`options: [{ text }]`). */
function toStoredQuestions(questions: BattleQuestion[]) {
  return {
    questions: questions.map((question) => ({
      question: question.question,
      options: question.options.map((text) => ({ text })),
      correctIndex: question.correctIndex,
    })),
  };
}
function parseQuestions(questionsJson: unknown): BattleQuestion[] {
  const parsed = battleQuestionsSchema.safeParse(questionsJson);
  if (!parsed.success) {
    throw new DomainError('Batalha corrompida.', 500);
  }
  return parsed.data.questions.map((q) => ({
    question: q.question,
    options: q.options.map((option) => option.text),
    correctIndex: q.correctIndex,
  }));
}

export async function listOpponents(tenantId: string, userId: string) {
  const db = getTenantDb(tenantId);
  const users = await db.user.findMany({
    where: { tenantId, id: { not: userId } },
    select: { id: true, name: true, department: true },
    orderBy: { name: 'asc' },
    take: 60,
  });
  return users.map((u: { id: string; name: string; department: string | null }) => ({
    id: u.id,
    name: u.name,
    department: u.department ?? null,
  }));
}

export async function listMyBattles(tenantId: string, userId: string) {
  const db = getTenantDb(tenantId);
  const battles = await db.battle.findMany({
    where: { tenantId, OR: [{ challengerId: userId }, { opponentId: userId }] },
    include: {
      challenger: { select: { name: true } },
      opponent: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  return battles.map((b) => ({
    id: b.id,
    status: b.status,
    challengerName: b.challenger.name,
    opponentName: b.opponent.name,
    challengerScore: b.challengerScore,
    opponentScore: b.opponentScore,
    challengerAnswered: b.challengerElapsed !== null,
    opponentAnswered: b.opponentElapsed !== null,
    forfeitedBy: b.forfeitedBy,
    winnerId: b.winnerId,
    createdAt: b.createdAt.toISOString(),
    expiresAt: b.expiresAt.toISOString(),
    isMine: b.challengerId === userId ? 'challenger' : b.opponentId === userId ? 'opponent' : null,
  }));
}

export async function createChallenge(tenantId: string, userId: string, opponentId: string) {
  const db = getTenantDb(tenantId);
  const opponent = await db.user.findFirst({
    where: { id: opponentId, tenantId },
    select: { id: true, name: true },
  });
  if (!opponent) throw new DomainError('Oponente não encontrado.', 404);
  if (opponent.id === userId) throw new DomainError('Você não pode desafiar a si mesmo.', 400);

  const pending = await db.battle.count({
    where: { tenantId, challengerId: userId, opponentId: opponent.id, status: 'pending' },
  });
  if (pending >= 3) throw new DomainError('Muitos desafios pendentes com este colega.', 429);

  const topics = safeTopics(await getTenantCourseTitles(tenantId));
  const questions = await generateBattleQuestions(tenantId, topics);
  const battle = await db.battle.create({
    data: {
      tenantId,
      challengerId: userId,
      opponentId: opponent.id,
      questionsJson: toStoredQuestions(questions),
      expiresAt: new Date(Date.now() + BATTLE_TTL_HOURS * 60 * 60 * 1000),
    },
  });

  const challenger = await db.user.findFirst({ where: { id: userId }, select: { name: true } });
  notifyBattleChallenge({
    tenantId,
    userId: opponent.id,
    challengerName: challenger?.name || 'Um colega',
    battleId: battle.id,
  });

  return { battleId: battle.id, questionsCount: questions.length };
}

export async function getOpenTurn(tenantId: string, userId: string, battleId: string) {
  const db = getTenantDb(tenantId);
  const battle = await db.battle.findFirst({ where: { id: battleId, tenantId } });
  if (!battle) throw new DomainError('Batalha não encontrada.', 404);

  const isChallenger = battle.challengerId === userId;
  const isOpponent = battle.opponentId === userId;
  if (!isChallenger && !isOpponent) throw new DomainError('Você não participa desta batalha.', 403);

  const myTurnDone = isChallenger ? battle.challengerElapsed !== null : battle.opponentElapsed !== null;
  const isMyTurn = isChallenger ? !myTurnDone : battle.challengerElapsed !== null && !myTurnDone;
  if (!isMyTurn) throw new DomainError('Ainda não é o seu turno.', 403);

  const questions = parseQuestions(battle.questionsJson);
  return {
    questions: questions.map((q) => ({ question: q.question, options: q.options })),
    questionTimeLimit: QUESTION_TIME_LIMIT_SECONDS,
    turnTimeLimit: TURN_TIME_LIMIT_SECONDS,
  };
}

export async function submitTurn(
  tenantId: string,
  userId: string,
  battleId: string,
  input: BattleTurnInput,
): Promise<BattleTurnResult> {
  const db = getTenantDb(tenantId);
  const battle = await db.battle.findFirst({ where: { id: battleId, tenantId } });
  if (!battle) throw new DomainError('Batalha não encontrada.', 404);

  const isChallenger = battle.challengerId === userId;
  const isOpponent = battle.opponentId === userId;
  if (!isChallenger && !isOpponent) throw new DomainError('Você não participa desta batalha.', 403);
  if (battle.expiresAt < new Date()) throw new DomainError('Este desafio expirou.', 410);

  const turnDone = isChallenger ? battle.challengerElapsed !== null : battle.opponentElapsed !== null;
  if (turnDone) throw new DomainError('Seu turno já foi registrado.', 409);
  if (battle.status === 'completed') throw new DomainError('Batalha já finalizada.', 409);

  const forfeited = Boolean(input.focusLost) || input.elapsedSeconds > TURN_TIME_LIMIT_SECONDS;
  const questions = parseQuestions(battle.questionsJson);
  const correct = forfeited ? questions.map(() => false) : scoreBattleTurn(questions, input.answers);
  const score = correct.filter(Boolean).length;

  // Reserva do turno com UPDATE condicional (compare-and-set).
  //
  // Antes: o turno era lido, validado e gravado com `update` simples. Sem o
  // lock distribuído (que agora é no-op sem Redis), dois POSTs concorrentes
  // passavam pela validação e ambos chegavam a `bothDone` — creditando os
  // departamentos duas vezes. Aqui o próprio banco decide quem grava o turno.
  const claim = await db.battle.updateMany({
    where: isChallenger
      ? { id: battle.id, challengerElapsed: null }
      : { id: battle.id, opponentElapsed: null },
    data: isChallenger
      ? { challengerScore: score, challengerElapsed: input.elapsedSeconds }
      : { opponentScore: score, opponentElapsed: input.elapsedSeconds },
  });

  if (claim.count === 0) {
    throw new DomainError('Seu turno já foi registrado.', 409);
  }

  const updated = await db.battle.findFirst({ where: { id: battle.id } });
  if (!updated) throw new DomainError('Batalha não encontrada.', 404);

  const bothDone = updated.challengerElapsed !== null && updated.opponentElapsed !== null;
  let winnerId: string | null = null;

  if (bothDone) {
    winnerId =
      updated.challengerScore > updated.opponentScore
        ? updated.challengerId
        : updated.opponentScore > updated.challengerScore
          ? updated.opponentId
          : null;

    // Só quem transiciona para 'completed' credita os departamentos — a
    // condição `status: { not: 'completed' }` impede crédito duplicado quando
    // os dois turnos chegam quase juntos em instâncias diferentes.
    const completion = await db.battle.updateMany({
      where: { id: battle.id, status: { not: 'completed' } },
      data: { status: 'completed', winnerId, forfeitedBy: forfeited ? userId : null },
    });

    if (completion.count === 0) {
      return { score, correct, completed: true, winnerId, forfeited };
    }

    const [challenger, opponent] = await Promise.all([
      db.user.findFirst({ where: { id: updated.challengerId }, select: { department: true, name: true } }),
      db.user.findFirst({ where: { id: updated.opponentId }, select: { department: true, name: true } }),
    ]);
    await Promise.all([
      creditDepartmentPoints(tenantId, challenger?.department ?? null, updated.challengerScore * BATTLE_POINTS_PER_CORRECT),
      creditDepartmentPoints(tenantId, opponent?.department ?? null, updated.opponentScore * BATTLE_POINTS_PER_CORRECT),
    ]);

    notifyBattleResult({
      tenantId,
      userId: updated.challengerId,
      opponentName: opponent?.name || 'Oponente',
      won: winnerId === updated.challengerId,
      score: updated.challengerScore,
    });
    notifyBattleResult({
      tenantId,
      userId: updated.opponentId,
      opponentName: challenger?.name || 'Desafiante',
      won: winnerId === updated.opponentId,
      score: updated.opponentScore,
    });
  }

  return { score, correct, completed: bothDone, winnerId, forfeited };
}