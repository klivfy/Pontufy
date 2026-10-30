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

const baseURL = process.env.PW_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  timeout: 30_000,
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
      name: 'api',
      testMatch: /api\/.*\.spec\.ts/,
      use: { baseURL },
    },
    {
      name: 'e2e',
      testMatch: /e2e\/.*\.spec\.ts/,
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
    command: 'npx next dev --webpack',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});