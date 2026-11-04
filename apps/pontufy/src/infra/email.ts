import { logger } from '@/infra/logger';

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Escape para conteúdo interpolado em templates de e-mail.
 * Nomes, títulos de curso e nomes de empresa são editáveis por usuário: sem
 * escape, HTML/e-mail injection com remetente legítimo da Pontufy.
 *
 * Implementação em `lib/html.ts` (módulo puro): este arquivo é infraestrutura
 * de e-mail e não deveria ser arrastado por quem só precisa escapar texto.
 */
import { escapeHtml } from '@/lib/html';

export { escapeHtml };


/**
 * B3 — grava o e-mail antes de tentar enviar.
 *
 * Antes: `fetch` para o Resend dentro da requisição. Se o provedor falhasse —
 * ou a função morresse — o e-mail simplesmente não existia, sem retry e sem
 * registro. Agora o evento é gravado primeiro e o worker
 * (`/api/cron/outbox-worker`) processa o que ficou pendente com backoff.
 *
 * Despacho imediato: depois de gravar, tentamos enviar na hora. O cron não é
 * confiável como único gatilho — depende do plano do Vercel e, no melhor caso,
 * faria o link de verificação chegar minutos depois do cadastro. Como o evento
 * já está no banco, a tentativa imediata não pode "perder" o e-mail: se ela
 * falhar, o evento continua `pending` para o worker.
 *
 * Retorno: `true` significa ACEITO (enviado agora ou enfileirado), não
 * garantia de entrega. Quem precisa de confirmação deve consultar o outbox.
 */
export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (process.env.OUTBOX_DISABLED === '1') {
    return sendEmailDirect(payload);
  }

  let eventId: string;

  try {
    eventId = await enqueueEmail(payload);
  } catch (error) {
    logger.warn(
      'Falha ao enfileirar e-mail — enviando direto',
      { to: payload.to, error: String(error) },
      'email',
    );
    return sendEmailDirect(payload);
  }

  try {
    const sent = await sendEmailDirect(payload);

    if (sent) {
      // Import dinâmico: `domain/outbox` chega a este módulo pelos handlers, e
      // um import estático fecharia o ciclo.
      const { markDone } = await import('@/domain/outbox');
      await markDone(eventId);
    }

    return true;
  } catch (error) {
    logger.warn(
      'Envio imediato falhou — evento permanece na fila',
      { to: payload.to, error: String(error) },
      'email',
    );
    return true;
  }
}

async function enqueueEmail(payload: EmailPayload): Promise<string> {
  const { enqueueEvent } = await import('@/domain/outbox');
  const { getRawPrisma } = await import('@/infra/platform-db');

  return enqueueEvent(getRawPrisma(), {
    type: 'email.send',
    payload: payload as unknown as Record<string, unknown>,
  });
}

/**
 * Transporte de e-mail — explícito, nunca implícito.
 *
 * O outbox resolveu "perder e-mail em silêncio", mas criou um segundo
 * silêncio: sem `RESEND_API_KEY` o envio "dava certo" (console.log + `true`) e
 * o evento era marcado como entregue. Em produção isso não é modo dev — é
 * e-mail que nunca sai, com o painel dizendo que saiu.
 *
 * `none` significa: produção sem provedor. Quem chama precisa FALHAR.
 * `log` é o console — só em dev/teste, ou quando pedido explicitamente.
 */
export type EmailTransport = 'resend' | 'log' | 'none';

export function emailTransport(): EmailTransport {
  const explicit = (process.env.EMAIL_TRANSPORT ?? '').trim().toLowerCase();
  if (explicit === 'log') return 'log';
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.NODE_ENV !== 'production') return 'log';
  return 'none';
}

/** Falso ⇒ nenhum e-mail sai. O worker usa isto para não consumir eventos. */
export function isEmailDeliveryConfigured(): boolean {
  return emailTransport() !== 'none';
}

export async function sendEmailDirect(payload: EmailPayload): Promise<boolean> {
  const transport = emailTransport();

  if (transport === 'none') {
    logger.error(
      'E-mail descartado: RESEND_API_KEY ausente em produção',
      { to: payload.to, subject: payload.subject },
      'email',
    );
    return false;
  }

  if (transport === 'log') {
    console.log(`[email:log] to=${payload.to} subject=${payload.subject}`);
    console.log(`[email:log] body=${payload.html.substring(0, 200)}...`);
    return true;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Pontufy <noreply@pontufy.com>',
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    logger.error(
      'Provedor de e-mail recusou o envio',
      { status: res.status, detail: detail.slice(0, 300) },
      'email',
    );
    return false;
  }

  return true;
}

export function resolveBaseUrl(): string {
  // Explicit canonical URL wins (already includes protocol).
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, '');
  // Vercel injects the deployment host without a protocol.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<boolean> {
  const resetUrl = `${resolveBaseUrl()}/reset-password?token=${token}`;

  return sendEmail({
    to,
    subject: 'Pontufy - Recuperação de Senha',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #495453;">Pontufy</h2>
        <p>Você solicitou a recuperação de senha.</p>
        <p>Clique no botão abaixo para criar uma nova senha:</p>
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #495453; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Redefinir Senha
        </a>
        <p style="color: #848484; font-size: 12px; margin-top: 24px;">
          Este link expira em 1 hora. Se você não solicitou esta recuperação, ignore este email.
        </p>
      </div>
    `,
  });
}

/**
 * Confirmação de e-mail do administrador na criação da empresa (V3).
 * O link aponta para uma PÁGINA (não para a API): scanners de e-mail fazem
 * prefetch de links e consumiriam um token de uso único.
 */
export async function sendEmailVerificationEmail(
  to: string,
  name: string,
  token: string,
): Promise<boolean> {
  const verifyUrl = `${resolveBaseUrl()}/verify-tenant?token=${encodeURIComponent(token)}`;

  return sendEmail({
    to,
    subject: 'Pontufy — confirme seu e-mail para ativar a empresa',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #495453;">Pontufy</h2>
        <p>Olá <strong>${escapeHtml(name)}</strong>, sua empresa foi criada.</p>
        <p>Para ativar a conta e liberar os créditos de IA do período de teste, confirme seu e-mail:</p>
        <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #495453; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Confirmar e-mail
        </a>
        <p style="color: #848484; font-size: 12px; margin-top: 24px;">
          Este link é de uso único e expira em 24 horas. Se você não criou esta conta, ignore este email.
        </p>
      </div>
    `,
  });
}

export async function sendWelcomeEmail(to: string, name: string): Promise<boolean> {  return sendEmail({
    to,
    subject: 'Bem-vindo ao Pontufy!',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #495453;">Pontufy</h2>
        <p>Olá <strong>${name}</strong>, seja bem-vindo(a) ao Pontufy!</p>
        <p>Sua conta foi criada com sucesso. Acesse a plataforma para explorar cursos e acumular pontos.</p>
        <p style="color: #848484; font-size: 12px;">Equipe Pontufy</p>
      </div>
    `,
  });
}

export async function sendInvitationEmail(
  to: string,
  companyName: string,
  signupUrl: string,
  expiresAt: Date,
): Promise<boolean> {
  const expiresLabel = expiresAt.toLocaleDateString('pt-BR');

  return sendEmail({
    to,
    subject: `${companyName} te convidou para o Pontufy!`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #495453;">Pontufy</h2>
        <p>Você foi convidado(a) para acessar a plataforma de benefícios da <strong>${companyName}</strong>.</p>
        <p>Clique no botão abaixo para criar sua conta:</p>
        <a href="${signupUrl}" style="display: inline-block; padding: 12px 24px; background: #495453; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Criar minha conta
        </a>
        <p style="color: #848484; font-size: 12px; margin-top: 24px;">
          Este convite expira em <strong>${expiresLabel}</strong>.
        </p>
        <p style="color: #848484; font-size: 12px;">Equipe Pontufy</p>
      </div>
    `,
  });
}

export async function sendRedemptionEmail(
  to: string,
  rewardTitle: string,
  affiliateLink: string,
): Promise<boolean> {
  return sendEmail({
    to,
    subject: `Pontufy - Resgate: ${rewardTitle}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #495453;">Pontufy</h2>
        <p>Parabéns! Você resgatou: <strong>${rewardTitle}</strong></p>
        <p>Acesse seu benefício pelo link abaixo:</p>
        <a href="${affiliateLink}" style="display: inline-block; padding: 12px 24px; background: #495453; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Acessar Benefício
        </a>
        <p style="color: #848484; font-size: 12px; margin-top: 24px;">Equipe Pontufy</p>
      </div>
    `,
  });
}

export async function sendAccountLockedEmail(
  to: string,
  ip: string,
  unlockUrl: string,
): Promise<boolean> {
  return sendEmail({
    to,
    subject: 'Pontufy - Alerta de Segurança: Conta Temporariamente Bloqueada',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #495453;">Pontufy</h2>
        <p>Detectamos <strong>5 tentativas de login falhas</strong> na sua conta.</p>
        <p><strong>IP de origem:</strong> ${ip}</p>
        <p>Por segurança, sua conta foi temporariamente bloqueada por 15 minutos.</p>
        <p>Se você reconhece esta atividade, desbloqueie sua conta agora:</p>
        <a href="${unlockUrl}" style="display: inline-block; padding: 12px 24px; background: #495453; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Desbloquear minha conta
        </a>
        <p style="color: #848484; font-size: 12px; margin-top: 24px;">
          Este link é de uso único e expira em 30 minutos. Se não foi você, ignore este email e considere trocar sua senha.
        </p>
      </div>
    `,
  });
}
