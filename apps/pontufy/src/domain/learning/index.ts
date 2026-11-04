import { getTenantDb } from '@/infra/db';
import { DomainError } from '@/domain/auth';
import { asPointsTx, creditPoints } from '@/domain/points';
import { burstMultiplier, countCompletionsToday, getStreak, getUserTier } from '@/domain/engagement';
import { creditDepartmentStudyHours, awardDepartmentBonusIfGoalMet } from '@/domain/engagement';
import { notifyLessonCompleted, notifyStreakMilestone, notifyLevelUp } from '@/lib/notifications';
import { checkVelocityLimit } from '@/lib/security/velocity';
import { recordNodeScore } from '@/domain/skills';
import { quizModulesSchema } from '@/schemas/quiz';

export const QUIZ_BONUS_POINTS = 50;
export const QUIZ_MIN_PERCENTAGE = 0.7;

export async function completeLesson(params: { tenantId: string; userId: string; lessonId: string }) {
  const { tenantId, userId, lessonId } = params;
  const db = getTenantDb(tenantId);

  const lesson = await db.lesson.findFirst({
    where: { id: lessonId },
    include: {
      course: {
        select: {
          id: true,
          title: true,
          workloadHours: true,
          _count: { select: { lessons: true } },
        },
      },
    },
  });
  if (!lesson) throw new DomainError('Aula não encontrada no escopo da empresa.', 404);

  const alreadyCompleted = await db.lessonCompletion.findFirst({ where: { userId, lessonId } });
  if (alreadyCompleted) {
    const user = await db.user.findFirst({ where: { id: userId } });
    return {
      success: true,
      message: 'Aula já concluída anteriormente.',
      newBalance: user?.pointsBalance ?? 0,
      alreadyCompleted: true,
    };
  }

  const velocity = await checkVelocityLimit(userId, tenantId);
  if (!velocity.allowed) throw new DomainError(velocity.reason ?? 'Limite de velocidade excedido.', 400);

  const completionsToday = await countCompletionsToday(userId, tenantId);
  const burst = burstMultiplier(completionsToday);
  const pointsToAward = Math.round(lesson.pointsAssigned * burst);

  const result = await (async () => {
    try {
      return await db.$transaction(async (tx) => {
        await tx.lessonCompletion.create({ data: { userId, tenantId, lessonId } });
        const updatedUser = await creditPoints(asPointsTx(tx), {
          userId,
          tenantId,
          amount: pointsToAward,
          description:
            burst > 1
              ? `Conclusão da Aula: ${lesson.title} (burst x${burst})`
              : `Conclusão da Aula: ${lesson.title}`,
        });
        return { updatedUser, duplicate: false as const };
      });
    } catch (error) {
      // P2002 = @@unique([userId, lessonId]) violado por uma requisição
      // concorrente que venceu a corrida. Não é erro de servidor: a conclusão
      // já existe. Isso mantém a idempotência mesmo SEM o lock distribuído.
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002') {
        const user = await db.user.findFirst({ where: { id: userId } });
        return { updatedUser: { id: userId, pointsBalance: user?.pointsBalance ?? 0 }, duplicate: true as const };
      }
      throw error;
    }
  })();

  if (result.duplicate) {
    return {
      success: true,
      message: 'Aula já concluída anteriormente.',
      newBalance: result.updatedUser.pointsBalance,
      alreadyCompleted: true,
    };
  }

  const streak = await getStreak(userId, tenantId);
  const isMilestone = streak.current >= 3 && (streak.current % 3 === 0 || streak.current <= 5);
  if (isMilestone) {
    notifyStreakMilestone({ tenantId, userId, streak: streak.current, best: streak.best });
  }

  const previousPoints = result.updatedUser.pointsBalance - pointsToAward;
  const beforeTier = getUserTier(previousPoints);
  const afterTier = getUserTier(result.updatedUser.pointsBalance);
  if (beforeTier.name !== afterTier.name) {
    notifyLevelUp({
      tenantId,
      userId,
      tierName: afterTier.name,
      pointsBalance: result.updatedUser.pointsBalance,
      link: '/dashboard',
    });
  }

  notifyLessonCompleted({
    tenantId,
    userId,
    lessonTitle: lesson.title,
    courseTitle: lesson.course?.title ?? lesson.title,
    points: pointsToAward,
    link: lesson.course ? `/player/${lesson.course.id}` : undefined,
  });

  const course = lesson.course;
  const hoursPerLesson =
    course && course.workloadHours > 0
      ? course.workloadHours / Math.max(1, course._count.lessons)
      : 0;
  const user = await db.user.findFirst({ where: { id: userId }, select: { department: true } });
  void creditDepartmentStudyHours(tenantId, user?.department ?? null, hoursPerLesson);
  void awardDepartmentBonusIfGoalMet(tenantId, user?.department ?? null);

  return {
    success: true,
    message:
      burst > 1
        ? `Você ganhou +${pointsToAward} pontos (burst x${burst})!`
        : `Você ganhou +${pointsToAward} pontos!`,
    newBalance: result.updatedUser.pointsBalance,
    burst,
    streak: streak.current,
  };
}

// A3 — o formato persistido do quiz vem de `schemas/quiz.ts`; as interfaces
// locais saíram para não existirem duas verdades sobre a mesma estrutura.

export async function submitQuiz(params: {
  tenantId: string;
  userId: string;
  courseId: string;
  answers: unknown;
}) {
  const { tenantId, userId, courseId, answers } = params;
  const db = getTenantDb(tenantId);

  const course = await db.course.findFirst({
    where: { id: courseId, status: 'published' },
    select: { id: true, title: true, quizJson: true },
  });
  if (!course) throw new DomainError('Curso não encontrado.', 404);
  if (!course.quizJson) throw new DomainError('Este curso não possui quiz de avaliação.', 400);

  // A3 — JSON nativo + validação de contrato. Aqui o erro é FATAL (500), não
  // silencioso: a nota do colaborador não pode ser calculada sobre dado
  // corrompido, e um `correctIndex` fora do intervalo invalidaria a correção.
  const modules = quizModulesSchema.parse(course.quizJson);

  const questions = modules.flatMap((m) => m.questions ?? []);
  if (questions.length === 0) throw new DomainError('Este curso não possui questões.', 400);

  const selected = Array.isArray(answers) ? answers : [];
  let score = 0;
  for (let i = 0; i < questions.length; i++) {
    const chosen = selected[i];
    const optionsCount = questions[i].options?.length ?? 0;
    if (
      Number.isInteger(chosen) &&
      typeof chosen === 'number' &&
      chosen >= 0 &&
      chosen < optionsCount &&
      chosen === questions[i].correctIndex
    ) {
      score++;
    }
  }

  const total = questions.length;
  const passed = score / total >= QUIZ_MIN_PERCENTAGE;

  let bonusAwarded = false;
  let newBalance: number | undefined;

  // Corrida no bônus: a checagem "primeiro passe" é um read-then-write. Duas
  // aprovações simultâneas do mesmo curso não viam uma à outra e creditavam
  // +QUIZ_BONUS_POINTS duas vezes. Não existe constraint natural para isso
  // (retakes são permitidos), então a serialização é do banco:
  // SERIALIZABLE faz o Postgres abortar um dos conflitos (P2034); no retry a
  // segunda transação JÁ VÊ a aprovação da primeira e não credita.
  const runQuizTransaction = () =>
    db.$transaction(
      async (tx) => {
        const attempt = await tx.quizAttempt.create({
          data: { userId, tenantId, courseId, score, total, passed },
        });

        if (passed) {
          const previousPass = await tx.quizAttempt.findFirst({
            where: { userId, courseId, passed: true, id: { not: attempt.id } },
            select: { id: true },
          });
          if (!previousPass) {
            const updated = await creditPoints(asPointsTx(tx), {
              userId,
              tenantId,
              amount: QUIZ_BONUS_POINTS,
              description: `Aprovação no Quiz: ${course.title}`,
            });
            bonusAwarded = true;
            newBalance = updated.pointsBalance;
          }
        }
      },
      { isolationLevel: 'Serializable' },
    );

  try {
    await runQuizTransaction();
  } catch (error) {
    const isSerializationFailure =
      error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2034';

    if (!isSerializationFailure) throw error;

    // Uma tentativa extra basta: no retry o conflito não existe mais.
    await runQuizTransaction();
  }

  if (passed && score / total >= 0.8) {
    const linkedNode = await db.skillNode.findFirst({ where: { courseId } });
    if (linkedNode) {
      await recordNodeScore(tenantId, userId, linkedNode.id, Math.round((score / total) * 100));
    }
  }

  return {
    success: true as const,
    score,
    total,
    passed,
    percentage: Math.round((score / total) * 100),
    bonusAwarded,
    newBalance,
  };
}