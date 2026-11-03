import { prisma } from '@/infra/db';
import { getRedis } from '@/infra/redis';

// ═══════════════════════════════════════════════════════════════════════════
// Versão de sessão por usuário (V5)
//
// O JWT do NextAuth é stateless: mudar o papel de alguém no banco não muda o
// token que já está no navegador. A versão de sessão é o contrapeso:
//   1. no login, o token recebe `sv` = versão atual do usuário;
//   2. a cada requisição privilegiada, `getSessionContext` compara `sv` com o
//      valor do banco (query que ele já fazia);
//   3. incrementar a versão invalida todas as sessões emitidas antes.
//
// Antes isso existia apenas no Redis — sem Redis, `revoke-all` era no-op e o
// acesso de um usuário demitido continuava válido por até 7 dias.
// ═══════════════════════════════════════════════════════════════════════════

/** Incrementa a versão no banco e espelha no Redis quando disponível. */
export async function bumpUserSessionVersion(userId: string): Promise<number> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`session-version:${userId}`, updated.sessionVersion);
    } catch {
      // Espelho é otimização; o banco é a verdade.
    }
  }

  return updated.sessionVersion;
}

/** Versão atual no banco (fonte da verdade). */
export async function currentSessionVersion(userId: string): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true },
  });
  return user?.sessionVersion ?? null;
}
