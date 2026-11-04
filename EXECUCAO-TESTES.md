# Resultado da primeira execução real da suíte

**Data:** 03/11/2026 · **Banco:** Postgres 16.4 portátil local (`127.0.0.1:5544`) · **Branch:** `feat/onda-b-hardening`

Contexto: até hoje a suíte de API **nunca havia rodado**. Foram necessárias 9 rodadas e 7 correções de infraestrutura de teste para chegar a uma execução válida. Este documento registra o que isso revelou — e cada correção serve também para o CI.

---

## 1. O que impediu a suíte de rodar (todos bugs reais)

| # | Sintoma | Causa | Correção |
|---|---|---|---|
| 1 | `Timeout waiting for webServer` (120s) | Playwright checa `/`, que redireciona para `/login` — nunca via 2xx | readiness em `/api/health` |
| 2 | `Invalid URL` | `webServer.url` relativa não é aceita | URL absoluta (`${baseURL}/api/health`) |
| 3 | `ECONNREFUSED ::1:3100` | `localhost` resolve para `::1`; o Next escuta em IPv4 | `baseURL` = `127.0.0.1` |
| 4 | `MODULE_NOT_FOUND prisma/build/index.js` | `global-setup` resolvia `apps/node_modules` (pasta inexistente), dependia do hoisting do npm | `createRequire().resolve()` a partir do `package.json` do app |
| 5 | `ERR_PACKAGE_PATH_NOT_EXPORTED tsx` | caminho cru `tsx/dist/cli.mjs` bloqueado pelo mapa `exports` | `tsx/cli` |
| 6 | `CredentialsSignin` em todos os logins | **V4**: sem Redis o login é fail-closed, e o NextAuth mascara a causa | causa logada explicitamente em `security-controls.ts` |
| 7 | 27 falhas 404/500 em cascata | fixtures ausentes (só o seed rodou) | projeto `test-setup` com dependência — aborta com a lista do que falta |

**Sobre o #6 — o achado mais importante.** O prompt do teste dizia "confira as credenciais"; as credenciais estavam corretas. O login era recusado porque **o Redis não existia no ambiente de teste**. Em produção o efeito é o mesmo: se o Upstash ficar fora, todo usuário vê "senha incorreta" e o suporte perde tempo atrás do problema errado. A mensagem de log agora é inequívoca.

**Sobre o #7 — por que nunca foi percebido.** O `global-setup` falhava antes de criar os fixtures, e a falha aparecia como *timeout de servidor*, não como erro de setup. Com o projeto `test-setup`, a suíte para no primeiro passo e diz exatamente o que falta.

---

## 2. Resultado da execução

```
28 passed · 27 failed · 9 skipped   (47,9s)
```

**Passaram integralmente:** validação Zod das rotas públicas (`malicious-payloads`), quotas e isolamento de upload, autenticação de cron, verificação de certificado, health check, e o contrato do interceptor em 4 de 5 casos.

---

## 3. Bloqueio remanescente: dependência de Redis no login

Os 20 testes que exigem login (`loginAs`) falham neste ambiente porque **não há Upstash aqui**, e a decisão D2 (fail-closed sem Redis) recusa a autenticação por desenho.

Isso não é um bug — é a política funcionando. Mas produz um efeito colateral que precisa de decisão explícita:

> **Nenhum caminho autenticado pode ser validado sem Redis.** O CI e a máquina de desenvolvimento ficam limitados aos testes públicos, a menos que se adote uma das opções abaixo.

| Opção | Efeito | Custo |
|---|---|---|
| **A. Test-only bypass** (`NODE_ENV=test` permite login sem Redis) | valida todos os fluxos em qualquer ambiente | exige garantir que `NODE_ENV=test` nunca exista em produção |
| **B. Redis efêmero no CI** (upstash-redis local via Docker/`services`) | ambiente fiel ao real | infraestrutura extra no CI |
| **C. Upstash de teste dedicado** | simples | custo e segredo no CI |

Recomendação: **B no CI** (fidelidade) e **A apenas local**, atrás de uma variável explícita (`ALLOW_LOGIN_WITHOUT_REDIS_TEST=1`) que aborta se `NODE_ENV=production`.

---

## 4. Como reproduzir

```powershell
# 1. Postgres portátil (uma vez)
$root = Join-Path $env:TEMP "pgportable"
Invoke-WebRequest "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip" -OutFile "$root\pg.zip"
Expand-Archive "$root\pg.zip" -DestinationPath $root

# 2. initdb + start (porta 5544)
# 3. migrações e fixtures
cd apps/pontufy
$env:DATABASE_URL="postgresql://postgres:pontufy@127.0.0.1:5544/pontufy"; $env:DIRECT_URL=$env:DATABASE_URL
node scripts/migrate.mjs

# 4. suíte (o global-setup aplica seed + fixtures)
$env:ALLOW_DESTRUCTIVE_TESTS="1"; $env:PW_BASE_URL="http://127.0.0.1:3100"
npx playwright test --project=api --workers=1
```

---

## 5. Estado dos gates

| Gate | Resultado |
|---|---|
| Migrações (7) no banco limpo | ✅ todas aplicadas |
| `prisma validate` | ✅ |
| Typecheck | ✅ |
| Build (produção) | ✅ |
| Rotas com autorização declarada | 65/65 |
| Suíte de API | 28 ✅ · 27 ❌ (Redis) · 9 ⏭ |
