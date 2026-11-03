# Execução — Fase 0 e Fase 1

**Data:** 02/11/2026 · **Base:** [PLANO-DE-ACAO.md](PLANO-DE-ACAO.md) · **Escopo:** `apps/pontufy`
**Status:** Fase 0 ✅ concluída · Fase 1 ✅ concluída (7/7 bloqueadores) · pendências operacionais listadas na seção 6

---

## 1. Estado dos gates (medido, não estimado)

| Gate | Antes | Depois | Comando |
|---|---|---|---|
| `tsc --noEmit` | **98 erros** (árvore de deps corrompida) | **0 erros** | `npm run typecheck -w apps/pontufy` |
| ESLint | 146 problemas (109 erros, 37 warnings) | 140 problemas (101 erros, 39 warnings) + **baseline congelado** | `npm run lint:ci -w apps/pontufy` |
| `npm audit --omit=dev` | **18** (4 críticos, 6 altos) | **0** | `npm audit --omit=dev --audit-level=high` |
| `next build` | não verificável (deps quebradas) | **exit 0** em Next 16.4.4 | `npm run build -w apps/pontufy` |
| CI | inexistente | workflow com 5 gates | `.github/workflows/ci.yml` |

> O número do ESLint caiu 6 problemas nos arquivos tocados; o restante (140) é dívida histórica, agora **travada**: o CI falha se o total aumentar.

---

## 2. Fase 0 — Destravar o ambiente e o processo

| ID | Entrega | Evidência |
|---|---|---|
| F0.1 | `npm ci` limpo (574 pacotes). As `.d.ts` ausentes de `ai`, `next-auth` e `lucide-react` voltaram — a árvore estava de fato corrompida, não era problema de `tsconfig` | `tsc --noEmit` → 0 erros (antes 98) |
| F0.2 | Scripts `typecheck`, `lint:ci`, `check` em `apps/pontufy/package.json` | `npm run check` executa |
| F0.3 | `scripts/lint-baseline.mjs` + `eslint-baseline.json` (dívida congelada, falha só se **aumentar**) | `Lint: 140 — baseline 140 ✅` |
| F0.4 | Backup do banco | ⚠️ **não executado** — exige acesso ao Supabase de produção (seção 6) |
| F0.5 | `.github/workflows/ci.yml`: install → prisma generate → typecheck → lint (baseline) → audit → build. Sem migração e sem seed por design | arquivo novo |
| F0.6 | Freeze de deploy | ⚠️ **ação humana** — combinar com o time antes do próximo push |

Detalhe do `lint-baseline.mjs`: usa a API do ESLint (sem `child_process`), porque no Windows `spawnSync` de `npx.cmd` estoura `EINVAL` e o pacote não expõe `bin/eslint.js` no `exports`.

---

## 3. Fase 1 — Bloqueadores (7/7)

### F1.1 · Dependências com CVE crítico ✅
`next 16.2.9 → 16.4.4` · `zod 4.4.3 → 4.6.7` · `next-auth beta.31 → beta.32` · `eslint-config-next 16.4.4` · `dompurify 3.4.17` (via `npm audit fix`).

- **18 → 0 vulnerabilidades** em produção.
- Some o *bypass de proxy/middleware* do Next (que era o único gate de RBAC de páginas) e o *fail-open* do Auth.js.
- `next build` verde, incluindo `ƒ Proxy (Middleware)`.

### F1.2 · Backdoor do `super_admin` ✅
| Antes | Depois |
|---|---|
| `migrate.mjs` rodava `check-and-seed.ts` em **todo deploy** | Bloco removido; comentário explica o porquê |
| `upsert` com `update: { passwordHash }` e `hashPassword('123456')` | `update: {}` + senha de `SEED_ADMIN_PASSWORD` (mín. 12), sem default |
| Rodava em produção | `assertLocalOnly()`: sai com erro se `NODE_ENV=production` ou `VERCEL_ENV` presente |
| `/api/setup/seed` usava `AUTH_SECRET` como API key, sem rate limit, vazando `details` | `404` fora de dev, `SETUP_SECRET` próprio (mín. 24) comparado em tempo constante, `SETUP_ADMIN_PASSWORD`, `details` removido |

### F1.3 · Perímetro: webhooks e crons ✅

**Afiliados** (`api/webhooks/affiliates`): reescrito.
- `AFFILIATE_WEBHOOK_SECRET` ausente ⇒ **503** (antes: aceitava tudo).
- HMAC obrigatório sobre `"<timestamp>.<rawBody>"` + janela de ±300s (anti-replay), comparação em tempo constante.
- **`trackingId` não é mais interpretado** (`tenantId:userId` vinha do corpo): agora precisa existir como `Redemption.trackingSubId`, e tenant/usuário vêm do banco. Tracking desconhecido ⇒ 404, nada creditado.
- Teto de comissão (`AFFILIATE_MAX_COMMISSION_VALUE`, default R$ 50k) e teto de **100.000 pontos por comissão** em `persistCommission`.
- P2002 da `@@unique([tenantId, network, orderId])` agora é tratado como "já processado", não como 500.

**Postback Lomadee**: token aceito por header `x-pontufy-token` (ou query, por compatibilidade), comparação `timingSafeEqual`, `503` se o segredo não estiver configurado.

**Crons** (4 rotas): `x-vercel-cron` **ignorado**. Novo `src/lib/security/cron-auth.ts` exige `Authorization: Bearer $CRON_SECRET`, `503` se o segredo faltar, comparação em tempo constante.

### F1.4 · Dinheiro ✅

**Preço server-side**
- `pointsCost` removido de `redeemSchema` (e o `productUrl` ganhou `max(2048)`).
- `RedeemInput.pointsCost` e a função `redeemLomadeeProduct` **deletados**. Produto agora só gera link de oferta (`browseOnly`), sem débito.
- `validateAffiliateUrl` passou a ser chamado também no fluxo de produto (antes só no de catálogo).

**Débito atômico** (`src/domain/points/index.ts`)
```ts
const r = await tx.user.updateMany({
  where: { id: userId, tenantId, pointsBalance: { gte: amount } },
  data:  { pointsBalance: { decrement: amount } },
});
if (r.count === 0) throw new PointsError('Saldo insuficiente.', 'INSUFFICIENT_BALANCE', ...);
```
- `creditPoints` também virou `updateMany` com `tenantId` no `where`; ambos validam inteiro ≥ 0 e tratam `0` como no-op (aula sem pontos não quebra).
- Bônus: `creditPoints`/`debitPoints` deixaram de usar `tx as never` — o corpo das funções agora é **checado de verdade** contra os tipos do Prisma (novo `asPointsTx`, um cast único na borda).

**Migração `20261102000000_add_points_balance_nonneg`**
```sql
UPDATE "User" SET "pointsBalance" = 0 WHERE "pointsBalance" < 0;   -- saneamento
ALTER TABLE "User" ADD CONSTRAINT "User_pointsBalance_nonneg"
  CHECK ("pointsBalance" >= 0) NOT VALID;                           -- sem lock longo
ALTER TABLE "User" VALIDATE CONSTRAINT "User_pointsBalance_nonneg";
```
\+ a mesma proteção para `PointsLedger.pointsAmount`.

**Lock com fencing** (`src/infra/mutex.ts`)
- `acquireLock` devolve `LockHandle { key, token, distributed }`.
- `releaseLock`/`extendLock` usam **compare-and-delete/expire** em Lua: só libera quem é dono. Antes, o Lua só testava `EXISTS` — uma requisição podia apagar o lock de outra.
- **Sem Redis o lock vira no-op** (`distributed: false`) em vez de 429 permanente. A correção agora é do banco, não do lock.
- Chamadas atualizadas em `rewards/redeem`, `lessons/complete`, `battles/[id]` e `courses/[id]/quiz`.
- `completeLesson` passou a tratar `P2002` como "já concluída" (idempotência sem depender do lock).

**I/O fora da transação**: a chamada HTTP à Lomadee saiu de dentro do `$transaction` do resgate.

### F1.5 · Certificados ✅
- `CERTIFICATE_VERIFICATION_SECRET` obrigatório (mín. 32) em produção — `throw` em vez de cair em `'pontufy-cert-secret-dev'`. Em dev, deriva de `AUTH_SECRET`.
- Payload canônico: JSON com chaves ordenadas + versão (`v: 2`), em vez de `join('|')` (que colidia quando um campo continha `|`).
- `timingSafeEqual` na verificação.
- Nova coluna `IssuedCertificate.signedPayload` (migração `20261102010000`) guarda a **string exata assinada**; a página pública verifica contra ela.
- Certificados antigos (sem payload) agora aparecem como **"emitido antes da verificação criptográfica"** (âmbar), não como "Inválido".

### F1.6 · Segredos documentados ✅
`.env.example` ganhou `AFFILIATE_WEBHOOK_SECRET`, `AFFILIATE_MAX_COMMISSION_VALUE`, `LOMADEE_POSTBACK_SECRET`, `CERTIFICATE_VERIFICATION_SECRET`, `SETUP_SECRET`, `SETUP_ADMIN_PASSWORD`, `SEED_ADMIN_PASSWORD`, e a nota de que **Redis é obrigatório em produção** (antes constava como "opcional"). `PRODUCTION.md` e `CLAUDE.md` atualizados.

### F1.7 · Testes de regressão ✅
`tests/api/security-regressions.spec.ts` (novo, 10 casos) cobre: header de cron forjável, Bearer inválido, webhook fail-closed, sem assinatura, assinatura inválida, `trackingId` inventado sem crédito, `pointsCost` ignorado, saldo insuficiente sem negativar e 5 resgates concorrentes → 1.
`tests/api/concurrency-points.spec.ts` reescrito para validar o **invariante** (1 ledger, 1 conclusão, saldo certo) em vez do status HTTP, funcionando com ou sem Redis.

---

## 4. Arquivos alterados

**Novos:** `.github/workflows/ci.yml`, `apps/pontufy/scripts/lint-baseline.mjs`, `apps/pontufy/eslint-baseline.json`, `apps/pontufy/src/lib/security/cron-auth.ts`, `apps/pontufy/tests/api/security-regressions.spec.ts`, 2 migrações.

**Modificados (26):** `package.json`, `package-lock.json`, `prisma/schema.prisma`, `scripts/{migrate,check-and-seed}`, `.env.example`, `PRODUCTION.md`, `CLAUDE.md`, `src/infra/mutex.ts`, `src/domain/{points,rewards,learning}`, `src/lib/{certificate-generator,certificate-service,validations/index}`, `src/app/api/{webhooks/affiliates,postback/lomadee,setup/seed,rewards/redeem,lessons/complete,battles/[id],courses/[id]/quiz,cron/*}`, `src/app/verify/[certificateId]/page.tsx`, `tests/api/concurrency-points.spec.ts`.

---

## 5. Como validar (o que foi e o que não foi verificado)

**Verificado nesta execução**
- `npm run typecheck -w apps/pontufy` → 0 erros.
- `npm run lint:ci -w apps/pontufy` → gate passa (140 = baseline).
- `npm audit --omit=dev --audit-level=high` → 0 vulnerabilidades.
- `npm run build -w apps/pontufy` → exit 0 (duas vezes, antes e depois das últimas mudanças).

**Não verificado (exige ambiente)**
- Os testes de `tests/` **não foram executados**: precisam de `DATABASE_URL` + Postgres migrado, e o `global-setup` **apaga** ledger/conclusões dos usuários de teste. Escolha deliberada por segurança.
- As 2 migrações não foram aplicadas em banco nenhum.
- Comportamento em runtime de rotas (login, resgate, certificado) — sem banco não há como exercitar.

**Para validar de verdade, nesta ordem:**
```bash
# 1. banco de teste (NUNCA produção)
docker compose up -d db
# 2. aplicar schema + migrações
DATABASE_URL=postgresql://pontufy:pontufy@localhost:5432/pontufy \
  npx prisma migrate deploy --schema apps/pontufy/prisma/schema.prisma
# 3. fixtures
DATABASE_URL=... npx tsx prisma/seed.ts
# 4. suíte de API (inclui os 10 testes de regressão)
DATABASE_URL=... CRON_SECRET=... AFFILIATE_WEBHOOK_SECRET=... \
  npx playwright test --project=api
```

---

## 6. Pendências (não são código — exigem produção/decisão)

| # | Pendência | Dono | Por que não foi feita aqui |
|---|---|---|---|
| 1 | **F1.0 — forense**: rodar as 3 consultas do plano em produção para saber se o backdoor foi usado | Vocês | exige acesso ao banco de produção |
| 2 | **Desativar `superadmin@pontufy.com`** ou trocar a senha por uma do cofre | Vocês | ação em produção |
| 3 | **Rotacionar segredos**: `AUTH_SECRET` (derruba todas as sessões — avisar antes), `CRON_SECRET`, `LOMADEE_POSTBACK_SECRET`, `CERTIFICATE_VERIFICATION_SECRET`, `STRIPE_WEBHOOK_SECRET` | Vocês | segredos vivem na Vercel |
| 4 | **Aplicar as 2 migrações** (`migrate deploy` com `DIRECT_URL`) | Vocês | não há banco acessível daqui |
| 5 | **Decisão R3**: confirmar o `UPDATE ... SET 0` nos saldos negativos (impacto financeiro) | Você | decisão de negócio |
| 6 | **Configurar os 4 segredos novos na Vercel** (Production **e** Preview) antes do próximo deploy | Vocês | — |
| 7 | Conferir `_prisma_migrations` (migração `slug NOT NULL` pode já ter falhado — R7) | Vocês | exige acesso |

> ⚠️ **Ordem importa:** configure os segredos novos **antes** de publicar. Se `AFFILIATE_WEBHOOK_SECRET` ou `CERTIFICATE_VERIFICATION_SECRET` faltarem em produção, o webhook de afiliados responde 503 e a emissão de certificado falha — ambos fail-closed, por design.

---

## 7. Próximo passo

Fase 2 do plano (semanas 2–3), começando por **F2.1 (idempotência do Stripe)** e **F2.2 (sync Lomadee não desativa o catálogo)** — os dois com impacto direto em receita. Depois **F2.3 (corridas de quiz/batalha)** e **F2.7 (migração fail-closed fora do build)**, que fecha o buraco que permite um deploy verde com schema defasado.
