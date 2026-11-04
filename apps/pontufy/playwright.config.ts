import { defineConfig } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Suíte E2E + Integração de API — Pontufy (Etapa 5)
// ─────────────────────────────────────────────────────────────────────────────
// Pré-requisitos (variáveis exportadas no shell):
//   DATABASE_URL            — obrigatório (Postgres com migrations aplicáveis)
//   DIRECT_URL              — opcional (fallback para DATABASE_URL)
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — obrigatórios para
//   testes de lock distribuído (conclusão de aulas usa Redis fail-closed).
//
// Execução:  npx playwright test          (toda a suíte)
//            npx playwright test --project=api   (somente integração)
//            npx playwright test --project=e2e   (somente UI)
//
// O webServer inicia `npm run dev` automaticamente (ou reutiliza um servidor
// já ativo na mesma porta — set PW_BASE_URL para apontar para outra instância).
// ─────────────────────────────────────────────────────────────────────────────

// `localhost` resolve para ::1 nesta máquina, mas o `next dev` escuta apenas em
// IPv4 (0.0.0.0). O resultado era ECONNREFUSED ::1 nos checks de prontidão e
// um timeout de 180s com o servidor no ar. 127.0.0.1 remove a ambiguidade.
const baseURL = process.env.PW_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',  timeout: 30_000,
  expect: { timeout: 10_000 },
  // workers=1: a suíte compartilha um único banco (mutações de saldo/ledger e
  // locks Redis são globais — paralelismo cruzaria estado entre testes).
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',

  projects: [
    {
      // Verifica os pré-requisitos do banco ANTES de qualquer spec. Sem isto,
      // um banco sem fixtures gerava 27 falhas em cascata (404/500/redirect)
      // que escondiam o motivo real. Aborta com a lista do que falta.
      name: 'test-setup',
      testMatch: /test-setup\.ts/,
    },
    {
      name: 'api',
      testMatch: /api\/.*\.spec\.ts/,
      dependencies: ['test-setup'],
      use: { baseURL },
    },
    {
      name: 'e2e',
      testMatch: /e2e\/.*\.spec\.ts/,
      dependencies: ['test-setup'],
      use: {
        baseURL,
        browserName: 'chromium',
        headless: true,
        acceptDownloads: true,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
        launchOptions: process.env.PW_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE }
          : undefined,
      },
    },
  ],

  webServer: {
    // Build de produção + `next start`, NÃO `next dev`.
    //
    // Dois motivos, ambos descobertos na primeira execução real da suíte:
    //  1. Quatro arquivos de teste importam `src/` diretamente (job-lock,
    //     tenant-db-contract, upload-quota, malicious-payloads). O watcher do
    //     `next dev` recompilava o servidor no meio da rodada, enquanto o
    //     `global-setup` apagava dados — resultado: falhas espúrias e ruído.
    //  2. O suíte deve exercitar o mesmo artefato que vai para produção.
    command: 'npm run build && npx next start -p 3100',
    // `localhost` resolve para ::1 nesta máquina; o servidor escuta em IPv4.
    // 127.0.0.1 remove a ambiguidade que travou os primeiros 4 timeouts.
    //
    // `/api/health` em vez de `/`: a raiz redireciona para /login (página
    // protegida), então o Playwright nunca via um 2xx e desistia com o
    // servidor já no ar. O health é 200 sem sessão e devolve 503 se o banco
    // estiver fora — prova runtime + banco em um único check.
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    // As variáveis chegam ao processo filho sem precisar exportar no shell.
    //
    // Antes o `instrumentation.ts` usava `NEXT_RUNTIME !== 'nodejs'` como guarda
    // de runtime: no `next dev` (processo de bootstrap, antes de o runtime ser
    // definido) o valor é `undefined`, então a validação de ambiente era pulada
    // e o servidor DOCUMENTAVA o boot mesmo sem banco — a suíte então falhava em
    // massa com 500, sem dizer o motivo. A guarda passou a usar "estamos em
    // build?" e este `env` garante que o servidor de teste tenha configuração
    // válida, com valores explicitamente de teste.
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      DIRECT_URL: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
      // NextAuth monta a Location de erro com `AUTH_URL`. Sem ele, o padrão é
      // http://localhost:3000 — host diferente do servidor de teste, e o
      // Playwright seguia o redirect para uma porta que não existe.
      AUTH_URL: baseURL,
      NEXTAUTH_URL: baseURL,
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'test-only-auth-secret-0000000000000000',
      CRON_SECRET: process.env.CRON_SECRET ?? 'test-only-cron-secret-0000000000000',
      AFFILIATE_WEBHOOK_SECRET:
        process.env.AFFILIATE_WEBHOOK_SECRET ?? 'test-only-affiliate-secret-0000',
      LOMADEE_POSTBACK_SECRET: process.env.LOMADEE_POSTBACK_SECRET ?? 'test-only-lomadee-secret-0000',
      CERTIFICATE_VERIFICATION_SECRET:
        process.env.CERTIFICATE_VERIFICATION_SECRET ?? 'test-only-certificate-secret-000000',
      // `next start` roda com NODE_ENV=production: sem esta linha o transporte
      // de e-mail seria `none` e o worker do outbox recusaria reivindicar
      // eventos — correto em produção sem provedor, inútil para testar o
      // encanamento. `log` imprime no console e reporta sucesso, sem rede.
      EMAIL_TRANSPORT: process.env.EMAIL_TRANSPORT ?? 'log',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});