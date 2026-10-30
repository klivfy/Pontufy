import NextAuth, { type DefaultSession } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/backend/db';
import { authConfig } from '@/auth.config';
import { verifyPassword } from '@/lib/crypto';
import {
  isAccountLocked,
  recordFailedLogin,
  createUnlockToken,
  clearAccountLockout,
} from '@/lib/security/auth-guard';
import { resolveBaseUrl, sendAccountLockedEmail } from '@/lib/email';
import { getRedis } from '@/lib/redis';
import { logAudit } from '@/lib/audit';
import { getTenantDb } from '@/backend/db';
import { verifyGoogleBridgeTicket } from '@/domain/auth/google-ticket';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      tenantId: string;
      role: string;
    } & DefaultSession['user'];
  }

  interface User {
    tenantId: string;
    role: string;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// auth.ts — configuração Node.js Runtime (único lugar autorizado a importar
// Prisma e crypto). auth.config.ts permanece Edge-safe (proxy/middleware).
// ═══════════════════════════════════════════════════════════════════════════

// 7.2/7.3 — Versão de sessão (revogação instantânea). Cada login carrega a
// versão atual do usuário; /api/auth/revoke-all incrementa a versão e derruba
// todas as sessões imediatamente (JWT stateless não permite revogação direta).
async function getSessionVersion(userId: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 1; // sem Redis: comportamento padrão (sem revogação ativa)
  const v = await redis.get<number>(`session-version:${userId}`);
  if (v === null) {
    await redis.set(`session-version:${userId}`, 1);
    return 1;
  }
  return v;
}

async function isSingleSessionEnabled(tenantId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  return (await redis.get<number>(`single-session:${tenantId}`)) === 1;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) return null;

          const email = String(credentials.email).trim().toLowerCase();

          // 6.1/6.3 — Lockout de conta (5 falhas / 15min) antes de verificar
          // credenciais. Falha de sessão não informa se o bloqueio existia.
          if (await isAccountLocked(email)) {
            console.warn(`[auth] Login recusado: conta bloqueada temporariamente (${email}).`);
            return null;
          }

          let user = await prisma.user.findUnique({
            where: { email },
          });

          // Fallback case-insensitive: PostgreSQL `=` é case-sensitive e dados
          // legados podem conter emails com maiúsculas.
          if (!user) {
            user = await prisma.user.findFirst({
              where: { email: { equals: email, mode: 'insensitive' } },
            });
          }

          if (!user || !user.passwordHash) {
            // Enumeração de usuários: não distingue usuário inexistente.
            await recordFailedLogin(email);
            console.warn(`[auth] Login recusado: usuário não encontrado (${email}).`);
            return null;
          }

          // 7.1 — Status ativo: usuário removido = sessão recusada; tenant
          // suspenso/cancelado bloqueia o acesso (sem isActive no modelo User —
          // evitando migration sem acesso ao banco; a coluna pode ser adicionada
          // depois via migration normal).
          const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
          const tenantBlocked =
            !tenant ||
            tenant.contractStatus === 'suspended' ||
            tenant.contractStatus === 'cancelled' ||
            tenant.subscriptionStatus === 'canceled';
          if (tenantBlocked) {
            console.warn(`[auth] Login recusado: tenant inativo (${user.tenantId}).`);
            return null;
          }

          const isValid = verifyPassword(
            credentials.password as string,
            user.passwordHash,
          );

          if (!isValid) {
            // 6.3 — Registra a falha; na 5ª, bloqueia a conta e envia alerta
            // de segurança com link mágico de desbloqueio (6.4).
            const state = await recordFailedLogin(email);
            console.warn(`[auth] Login recusado: senha inválida (${email}).`);
            // 9.1 — Auditoria de falha de autenticação (forense de brute force).
            await logAudit({
              tenantId: user.tenantId,
              userId: user.id,
              action: 'LOGIN_FAILED',
              entity: 'User',
              entityId: user.id,
              newValue: { reason: 'invalid_password', attempt: state.remainingAttempts },
            });
            if (state.locked && state.shouldNotify) {
              const unlockToken = await createUnlockToken(email);
              const unlockUrl = unlockToken
                ? `${resolveBaseUrl()}/unlock-account?token=${unlockToken}`
                : `${resolveBaseUrl()}/forgot-password`;
              await sendAccountLockedEmail(email, 'não informado', unlockUrl);
              await logAudit({
                tenantId: user.tenantId,
                userId: user.id,
                action: 'ACCOUNT_LOCKED',
                entity: 'User',
                entityId: user.id,
                newValue: { reason: 'max_attempts', windowSeconds: 15 * 60 },
              });
            }
            return null;
          }

          // Super admins must originate from the @pontufy.com domain.
          if (user.role === 'super_admin' && !user.email.endsWith('@pontufy.com')) {
            console.warn(`[auth] Login recusado: super_admin fora do domínio @pontufy.com (${email}).`);
            return null;
          }

          // Login bem-sucedido limpa qualquer contagem de falhas acumulada.
          await clearAccountLockout(email);

          // 9.1 — Auditoria de login bem-sucedido.
          await logAudit({
            tenantId: user.tenantId,
            userId: user.id,
            action: 'LOGIN_SUCCESS',
            entity: 'User',
            entityId: user.id,
            newValue: { role: user.role },
          });

          console.log(`[auth] Login OK: ${email} (${user.role}).`);
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            tenantId: user.tenantId,
            role: user.role,
          };
        } catch (err) {
          console.error('[auth] authorize error:', err);
          return null;
        }
      },
    }),
    CredentialsProvider({
      id: 'google-bridge',
      name: 'Google',
      credentials: {
        ticket: { label: 'ticket', type: 'text' },
      },
      async authorize(credentials) {
        try {
          const ticket = typeof credentials?.ticket === 'string' ? credentials.ticket : '';
          const userId = verifyGoogleBridgeTicket(ticket);
          if (!userId) return null;

          const user = await prisma.user.findUnique({ where: { id: userId } });
          if (!user) return null;

          const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
          const tenantBlocked =
            !tenant ||
            tenant.contractStatus === 'suspended' ||
            tenant.contractStatus === 'cancelled' ||
            tenant.subscriptionStatus === 'canceled';
          if (tenantBlocked) return null;

          if (user.role === 'super_admin' && !user.email.endsWith('@pontufy.com')) {
            return null;
          }

          await logAudit({
            tenantId: user.tenantId,
            userId: user.id,
            action: 'LOGIN_SUCCESS',
            entity: 'User',
            entityId: user.id,
            newValue: { role: user.role, via: 'google' },
          });

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            tenantId: user.tenantId,
            role: user.role,
          };
        } catch (err) {
          console.error('[auth] google-bridge authorize error:', err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    // 7.3 — Validação da versão de sessão a cada requisição: revogada →
    // token nulo (sessão invalidada sem depender do cookie).
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tenantId = user.tenantId;
        token.role = user.role;

        // 7.2 — Single-device: se ativado para o tenant, cada login gera uma
        // nova versão e invalida sessões anteriores.
        const uid = user.id as string;
        const single = await isSingleSessionEnabled(user.tenantId as string);
        const version = single
          ? (await getSessionVersion(uid)) + 1
          : await getSessionVersion(uid);
        if (single) {
          const redis = getRedis();
          if (redis) await redis.set(`session-version:${uid}`, version);
        }
        token.sessionVersion = version;
      } else if (token.sessionVersion !== undefined) {
        const current = await getSessionVersion(token.id as string);
        if (current !== token.sessionVersion) {
          // Sessão revogada (revoke-all ou novo login single-device).
          return null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.tenantId = token.tenantId as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
});