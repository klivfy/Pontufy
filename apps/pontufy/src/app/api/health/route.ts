import { NextResponse } from 'next/server';
import { prisma } from '@/infra/db';
import { getRedis } from '@/infra/redis';
import { emailTransport } from '@/infra/email';
import { isSentryEnabled } from '@/infra/sentry';

// Health check real (V4): banco + Redis, sem autenticação e sem chamar LLM.
// Substitui o uso de /api/ai/health como probe — aquele exigia papel de admin
// e disparava 3 chamadas reais a provedores de IA a cada verificação.
export const dynamic = 'force-dynamic';

type ComponentStatus = 'up' | 'down' | 'not_configured';

export async function GET() {
  const startedAt = Date.now();

  let db: ComponentStatus = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'up';
  } catch {
    db = 'down';
  }

  const redisClient = getRedis();
  let redis: ComponentStatus = 'not_configured';
  if (redisClient) {
    try {
      await redisClient.ping();
      redis = 'up';
    } catch {
      redis = 'down';
    }
  }

  // Banco é obrigatório; Redis degrada (a aplicação sobe, autenticação não).
  const healthy = db === 'up' && redis !== 'down';

  // E-mail não derruba a aplicação: as páginas continuam servindo. Mas um
  // deploy sem provedor não cadastra empresa nenhuma (o login do admin nasce
  // bloqueado até o link chegar), então isto precisa estar visível no probe —
  // foi exatamente o que faltou para o problema do outbox passar despercebido.
  const transport = emailTransport();

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      db,
      redis,
      // Sem Redis a autenticação é fail-closed — o probe precisa mostrar isso.
      auth: redis === 'up' ? 'available' : 'unavailable',
      email: transport === 'none' ? 'not_configured' : transport,
      // Sem DSN não há captura de erro: o stack trace morre no log da
      // plataforma. É opcional de propósito — mas precisa estar visível.
      errors: isSentryEnabled() ? 'sentry' : 'not_configured',
      warnings: [
        ...(transport === 'none'
          ? ['email: RESEND_API_KEY ausente — nenhum e-mail é entregue em produção']
          : []),
        ...(transport === 'log'
          ? ['email: transporte de console (dev/teste) — nada é entregue de fato']
          : []),
        ...(isSentryEnabled()
          ? []
          : ['errors: SENTRY_DSN ausente — exceções não são reportadas a nenhum serviço']),
      ],
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
