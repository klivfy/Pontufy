/**
 * Instrumentation hook do Next.js (App Router).
 *
 * `register()` roda UMA vez por processo de servidor, ANTES da primeira
 * requisição. É o único ponto confiável para falhar rápido em configuração
 * inválida — validar dentro de cada módulo significava descobrir o problema no
 * meio de um checkout ou de um postback.
 *
 * Regras:
 *  • `NEXT_RUNTIME !== 'nodejs'` → no-op (o Edge runtime, usado pelo proxy, não
 *    tem acesso a estes módulos nem ao banco).
 *  • Build de produção → no-op. O deploy não deve quebrar porque uma variável
 *    de runtime ainda não foi configurada no ambiente de preview; quem valida
 *    é o processo que vai servir tráfego.
 *  • Import dinâmico: `infra/env` é server-only e não pode entrar no bundle do
 *    Edge.
 */
export async function register(): Promise<void> {
  // PHASE_PRODUCTION_BUILD não é importado de 'next/constants' de propósito:
  // este arquivo também é avaliado fora do bundler do Next.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  // Observabilidade vem PRIMEIRO: se a validação de ambiente abaixo abortar o
  // boot, o erro de configuração precisa ter para onde ir. Os arquivos
  // `sentry.*.config.ts` são no-op quando `SENTRY_DSN` não existe, então isto
  // não custa nada em dev nem em preview sem Sentry.
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  } else if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }

  // Cada varredura `x1..x60` (Next 16 roda vários workers em dev) imprimia o
  // mesmo relatório de ambiente. Valida uma vez por processo, no primeiro
  // worker que de fato serve requisições.
  const globalForEnv = globalThis as unknown as { __pontufyEnvChecked?: boolean };
  if (globalForEnv.__pontufyEnvChecked) return;
  globalForEnv.__pontufyEnvChecked = true;

  const { assertServerEnv } = await import('@/infra/env');
  assertServerEnv();
}

/**
 * Erro não tratado em route handler, server action ou render de RSC.
 *
 * Sem este hook, o erro só existe no log da plataforma — que ninguém lê até o
 * cliente reclamar. Compatível com o `instrumentation.ts` que já existia (o
 * Next 16 aceita um único arquivo de instrumentação).
 */
export { captureRequestError as onRequestError } from '@sentry/nextjs';
