import { prisma } from '@/infra/db';
import { logger } from '@/infra/logger';

// ═══════════════════════════════════════════════════════════════════════════
// Exclusão mútua de jobs (V7)
//
// Cenário real: o cron das 03:00 demora mais que o esperado, a Vercel repete a
// chamada e o disparo manual do operador acontece junto. Três execuções
// processam o mesmo lote — pontos creditados/desativados mais de uma vez.
//
// Implementação: claim por TTL numa tabela (INSERT ... ON CONFLICT ... WHERE
// expirado). Funciona com pooler e sem Redis; o TTL garante que um processo
// morto no meio do job não deixe o lock preso para sempre.
// ═══════════════════════════════════════════════════════════════════════════

export interface JobLock {
  acquired: boolean;
  name: string;
  release: () => Promise<void>;
}

const DEFAULT_TTL_MINUTES = 15;

/**
 * Tenta assumir o job. `acquired: false` significa que outra execução está
 * com ele (ou o TTL ainda não expirou).
 */
export async function acquireJobLock(
  name: string,
  ttlMinutes: number = DEFAULT_TTL_MINUTES,
): Promise<JobLock> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  const noop = async () => {};

  try {
    // 1 = linha inserida ou tomada de um lock expirado (nós somos os donos).
    // 0 = outra execução está com o lock dentro do TTL.
    const affected = await prisma.$executeRaw`
      INSERT INTO "JobLock" ("name", "expiresAt", "updatedAt")
      VALUES (${name}, ${expiresAt}, ${now})
      ON CONFLICT ("name") DO UPDATE
        SET "expiresAt" = EXCLUDED."expiresAt",
            "updatedAt" = EXCLUDED."updatedAt"
        WHERE "JobLock"."expiresAt" < ${now}
    `;

    const acquired = Number(affected) > 0;

    if (!acquired) {
      logger.warn('Job ignorado: outra execução está em andamento.', { job: name }, 'jobs');
      return { acquired: false, name, release: noop };
    }

    return {
      acquired: true,
      name,
      release: async () => {
        try {
          await prisma.$executeRaw`
            UPDATE "JobLock" SET "expiresAt" = ${new Date(0)}, "updatedAt" = ${new Date()}
            WHERE "name" = ${name}
          `;
        } catch (error) {
          // Não derruba o job: no pior caso o lock expira pelo TTL.
          logger.warn('Falha ao liberar JobLock', { job: name, error: String(error) }, 'jobs');
        }
      },
    };
  } catch (error) {
    // Se a própria tabela falhar, preferimos rodar o job a travá-lo em silêncio.
    logger.error('Falha ao adquirir JobLock — job seguirá sem exclusão mútua.', {
      job: name,
      error: String(error),
    }, 'jobs');
    return { acquired: true, name, release: noop };
  }
}
