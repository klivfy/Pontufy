type EmailPayload = {
  to: string;
  subject: string;
  html: string;
};

async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.log(`[DEV] Email to ${payload.to}: ${payload.subject}`);
    console.log(`[DEV] Body: ${payload.html.substring(0, 200)}...`);
    return true;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
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
    console.error('Email send failed:', await res.text());
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
        <h2 style="color: #10b981;">Pontufy</h2>
        <p>Você solicitou a recuperação de senha.</p>
        <p>Clique no botão abaixo para criar uma nova senha:</p>
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Redefinir Senha
        </a>
        <p style="color: #666; font-size: 12px; margin-top: 24px;">
          Este link expira em 1 hora. Se você não solicitou esta recuperação, ignore este email.
        </p>
      </div>
    `,
  });
}

export async function sendWelcomeEmail(to: string, name: string): Promise<boolean> {
  return sendEmail({
    to,
    subject: 'Bem-vindo ao Pontufy!',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #10b981;">Pontufy</h2>
        <p>Olá <strong>${name}</strong>, seja bem-vindo(a) ao Pontufy!</p>
        <p>Sua conta foi criada com sucesso. Acesse a plataforma para explorar cursos e acumular pontos.</p>
        <p style="color: #666; font-size: 12px;">Equipe Pontufy</p>
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
        <h2 style="color: #10b981;">Pontufy</h2>
        <p>Você foi convidado(a) para acessar a plataforma de benefícios da <strong>${companyName}</strong>.</p>
        <p>Clique no botão abaixo para criar sua conta:</p>
        <a href="${signupUrl}" style="display: inline-block; padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Criar minha conta
        </a>
        <p style="color: #666; font-size: 12px; margin-top: 24px;">
          Este convite expira em <strong>${expiresLabel}</strong>.
        </p>
        <p style="color: #666; font-size: 12px;">Equipe Pontufy</p>
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
        <h2 style="color: #10b981;">Pontufy</h2>
        <p>Parabéns! Você resgatou: <strong>${rewardTitle}</strong></p>
        <p>Acesse seu benefício pelo link abaixo:</p>
        <a href="${affiliateLink}" style="display: inline-block; padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Acessar Benefício
        </a>
        <p style="color: #666; font-size: 12px; margin-top: 24px;">Equipe Pontufy</p>
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
        <h2 style="color: #10b981;">Pontufy</h2>
        <p>Detectamos <strong>5 tentativas de login falhas</strong> na sua conta.</p>
        <p><strong>IP de origem:</strong> ${ip}</p>
        <p>Por segurança, sua conta foi temporariamente bloqueada por 15 minutos.</p>
        <p>Se você reconhece esta atividade, desbloqueie sua conta agora:</p>
        <a href="${unlockUrl}" style="display: inline-block; padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Desbloquear minha conta
        </a>
        <p style="color: #666; font-size: 12px; margin-top: 24px;">
          Este link é de uso único e expira em 30 minutos. Se não foi você, ignore este email e considere trocar sua senha.
        </p>
      </div>
    `,
  });
}
