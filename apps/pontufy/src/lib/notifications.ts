import { getTenantDb } from '@/backend/db';
import { publishToUser } from '@/infra/sse';
import { incrementUnreadCount } from '@/lib/redis';

export type NotificationType =
  | 'POINTS_EARNED'
  | 'REWARD_REDEEMED'
  | 'COURSE_ASSIGNED'
  | 'LEVEL_UP'
  | 'SYSTEM'
  | 'BATTLE_CHALLENGE'
  | 'BATTLE_RESULT'
  | 'CERTIFICATE_READY'
  | 'DEPT_BONUS_AWARDED';

export interface NotificationPayload {
  tenantId: string;
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  link?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Cria uma notificação persistida e propaga em tempo real (SSE) para o tenant.
 *
 * Resiliência / Desacoplamento:
 *  - A função NUNCA lança erro — qualquer falha (banco, redis) é absorvida
 *    e logada, para não quebrar a rota principal que a dispara.
 *  - Os chamadores DEVEM usar fire-and-forget (`void dispatchNotification(...)`)
 *    para não bloquear a resposta da rota.
 */
export async function dispatchNotification(
  payload: NotificationPayload,
): Promise<void> {
  try {
    const db = getTenantDb(payload.tenantId);
    await db.notification.create({
      data: {
        tenantId: payload.tenantId,
        userId: payload.userId,
        title: payload.title,
        message: payload.message,
        type: payload.type,
        link: payload.link ?? null,
        metadata: payload.metadata ?? undefined,
      },
    });

    publishToUser(payload.tenantId, payload.userId, 'notification', {
      userId: payload.userId,
      title: payload.title,
      message: payload.message,
      type: payload.type,
      link: payload.link ?? null,
    });

    // Incrementa contador Redis de não-lidas (badge)
    incrementUnreadCount(payload.tenantId, payload.userId, 1).catch(() => {});
  } catch (err) {
    console.error('Falha ao despachar notificação (não-bloqueante):', err);
  }
}

export function notifyLessonCompleted(params: {
  tenantId: string;
  userId: string;
  lessonTitle: string;
  courseTitle: string;
  points: number;
  link?: string;
}): void {
  void dispatchNotification({
    tenantId: params.tenantId,
    userId: params.userId,
    type: 'POINTS_EARNED',
    title: 'Aula concluída!',
    message: `Você completou "${params.lessonTitle}" em "${params.courseTitle}" e ganhou +${params.points} pontos.`,
    link: params.link,
    metadata: { lessonTitle: params.lessonTitle, courseTitle: params.courseTitle, points: params.points },
  });
}

export function notifyRewardRedeemed(params: {
  tenantId: string;
  userId: string;
  rewardTitle: string;
  pointsSpent: number;
  link?: string;
}): void {
  void dispatchNotification({
    tenantId: params.tenantId,
    userId: params.userId,
    type: 'REWARD_REDEEMED',
    title: 'Recompensa resgatada',
    message: `Você resgatou "${params.rewardTitle}" por ${params.pointsSpent} pontos. Aproveite!`,
    link: params.link,
    metadata: { rewardTitle: params.rewardTitle, pointsSpent: params.pointsSpent },
  });
}

export function notifyCourseAssigned(params: {
  tenantId: string;
  userId: string;
  courseTitle: string;
  link?: string;
}): void {
  void dispatchNotification({
    tenantId: params.tenantId,
    userId: params.userId,
    type: 'COURSE_ASSIGNED',
    title: 'Novo curso disponível',
    message: `O curso "${params.courseTitle}" foi atribuído a você. Comece a aprender!`,
    link: params.link,
    metadata: { courseTitle: params.courseTitle },
  });
}

export function notifyLevelUp(params: {
  tenantId: string;
  userId: string;
  tierName: string;
  pointsBalance: number;
  link?: string;
}): void {
  void dispatchNotification({
    tenantId: params.tenantId,
    userId: params.userId,
    type: 'LEVEL_UP',
    title: 'Você subiu de nível!',
    message: `Parabéns, você agora é nível "${params.tierName}" com ${params.pointsBalance} pontos.`,
    link: params.link,
    metadata: { tierName: params.tierName, pointsBalance: params.pointsBalance },
  });
}

export function notifySystem(params: {
  tenantId: string;
  userId: string;
  title: string;
  message: string;
  link?: string;
}): void {
  void dispatchNotification({
    tenantId: params.tenantId,
    userId: params.userId,
    type: 'SYSTEM',
    title: params.title,
    message: params.message,
    link: params.link,
  });
}

// 11.5 — Notificação inteligente de milestone de streak.
export function notifyStreakMilestone(params: {
  tenantId: string;
  userId: string;
  streak: number;
  best: number;
  link?: string;
}): void {
  void dispatchNotification({
    tenantId: params.tenantId,
    userId: params.userId,
    type: 'LEVEL_UP',
    title: `Streak de ${params.streak} dias! 🔥`,
    message:
      params.streak === params.best
        ? `Novo recorde pessoal! Continue assim, sua melhor marca agora é ${params.streak} dias.`
        : `Você completou ${params.streak} dias seguidos de aprendizado.`,
    link: params.link,
    metadata: { streak: params.streak, best: params.best, milestone: true },
  });
}

// 13.x — Notificação de desafio de batalha recebido.
export function notifyBattleChallenge(params: {
  tenantId: string;
  userId: string;
  challengerName: string;
  battleId: string;
  link?: string;
}): void {
  void dispatchNotification({
    tenantId: params.tenantId,
    userId: params.userId,
    type: 'BATTLE_CHALLENGE',
    title: 'Novo desafio de batalha!',
    message: `${params.challengerName} te desafiou para um duelo de conhecimento.`,
    link: params.link ?? `/battles`,
    metadata: { battleId: params.battleId, challengerName: params.challengerName },
  });
}

// 13.x — Notificação de resultado de batalha finalizada.
export function notifyBattleResult(params: {
  tenantId: string;
  userId: string;
  opponentName: string;
  won: boolean;
  score: number;
  link?: string;
}): void {
  void dispatchNotification({
    tenantId: params.tenantId,
    userId: params.userId,
    type: 'BATTLE_RESULT',
    title: params.won ? 'Você venceu o duelo!' : 'Duelo finalizado',
    message: params.won
      ? `Você derrotou ${params.opponentName} com ${params.score} acertos! +${params.score * 5} pts para seu departamento.`
      : `Você perdeu para ${params.opponentName}. Tente novamente na próxima!`,
    link: params.link ?? `/battles`,
    metadata: { opponentName: params.opponentName, won: params.won, score: params.score },
  });
}

// 14.x — Notificação de certificado pronto para download.
export function notifyCertificateReady(params: {
  tenantId: string;
  userId: string;
  courseName: string;
  link?: string;
}): void {
  void dispatchNotification({
    tenantId: params.tenantId,
    userId: params.userId,
    type: 'CERTIFICATE_READY',
    title: 'Certificado emitido! 🏆',
    message: `Seu certificado de "${params.courseName}" está pronto. Baixe e compartilhe!`,
    link: params.link ?? `/certificados`,
    metadata: { courseName: params.courseName },
  });
}

// 13.5 — Notificação de bônus coletivo de departamento concedido.
export function notifyDeptBonusAwarded(params: {
  tenantId: string;
  userId: string;
  department: string;
  bonusPoints: number;
  link?: string;
}): void {
  void dispatchNotification({
    tenantId: params.tenantId,
    userId: params.userId,
    type: 'DEPT_BONUS_AWARDED',
    title: 'Bônus coletivo concedido!',
    message: `Seu departamento "${params.department}" atingiu a meta semanal! +${params.bonusPoints} pts para cada membro.`,
    link: params.link ?? `/battles`,
    metadata: { department: params.department, bonusPoints: params.bonusPoints },
  });
}