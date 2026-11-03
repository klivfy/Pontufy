# Plano de ação — Pontufy

**Base:** [ANALISE-TECNICA.md](ANALISE-TECNICA.md) (02/11/2026) · **Horizonte:** 6 semanas + backlog
**Premissa de capacidade:** 1 dev full-stack em tempo integral (ajustável: as fases 1 e 2 paralelizam bem entre 2 pessoas). Esforços em **dev-days (d)**.

> **Status em 02/11/2026 (fim do dia 1):** **Fase 0 ✅** (ambiente, scripts, baseline de lint, CI) e **Fase 1 ✅** (7/7 bloqueadores) concluídas.
> Evidências, arquivos alterados e pendências operacionais em [EXECUCAO-FASE-1.md](EXECUCAO-FASE-1.md).
> Próximo: **Fase 2**, começando por F2.1 (Stripe) e F2.2 (sync Lomadee).

---

## 0. Princípios de priorização

A ordem de execução segue o **tipo de dano**, não a facilidade:

1. **Parar a perda/forja de dinheiro** — pontos são passivo financeiro real (viram vale-compras).
2. **Fechar o acesso total** — backdoor de `super_admin`, segredos públicos, dependências com RCE.
3. **Parar a duplicação silenciosa** — corridas, idempotência, catálogo que se autodestrói.
4. **Tornar o deploy confiável** — hoje uma migração falhada passa verde.
5. **Qualidade de produto e dívida estrutural** — importante, mas nada disso importa se 1–4 não estiverem resolvidos.

**Regras de condução**
- **Congelamento de deploy em produção** até o fim da Fase 1 (só hotfix crítico, com aprovação).
- Nenhum refactor estrutural antes dos P0 — nada de "já que estamos aqui".
- Toda correção entra com **um teste que falha antes e passa depois**. Sem teste, não fecha.
- PRs pequenos (≤ 300 linhas), um achado por PR, mensagem `fix(sec): ...` / `fix(money): ...` — facilita reverter.
- Nada de `db push`; toda mudança de schema em migração versionada e revisada.
- O que exigir decisão de negócio fica marcado **[DECISÃO]** e vai para a seção 8.

---

## 1. Visão geral

| Fase | Janela | Objetivo | Gate de saída (go/no-go) | Esforço |
|---|---|---|---|---|
| **0 · Destravar** | Dia 1–2 | Ambiente reprodutível, backup, CI mínimo, deploy freeze | `npm ci && npm run build` verde num clone limpo; CI rodando; backup validado | 2 d |
| **1 · Bloqueadores** | Semana 1 (dias 1–5) | Fechar os 7 P0 do relatório | 4 vetores de ataque reproduzidos e neutralizados + segredos rotacionados | 5 d |
| **2 · Integridade** | Semanas 2–3 | Corridas, idempotência, isolamento, deploy fail-fast | Suíte de concorrência e de isolamento verde; migração nunca passa silenciosa | 9 d |
| **3 · Qualidade** | Semanas 4–6 | CI bloqueante, testes unitários, observabilidade, produto | `tsc`/`lint`/`test` bloqueando merge; cupom real; landing convertendo | 12 d |
| **Backlog** | — | Dívida estrutural (enums, `Json`, soft delete, `PointsLot` completo) | — | — |

```
Semana 1   ████████ Fase 0 + Fase 1 (P0)  →  MILESTONE: produção segura
Semana 2-3 ████████ Fase 2A (dinheiro) + 2B (isolamento/deploy)
Semana 4-6 ████████ Fase 3A (CI/testes) + 3B (produto) + 3C (dívida)
```

> **Nota de sequência:** a **F1.0 (avaliação de comprometimento)** roda em paralelo no dia 1, antes de qualquer correção. O backdoor `superadmin@pontufy.com` / `123456` esteve ativo em produção — é preciso saber se foi usado **antes** de fechar a porta.

---

## 2. Fase 0 — Destravar o ambiente e o processo (Dia 1–2 · 2 d)

Objetivo: conseguir desenvolver, verificar e reverter com segurança. Sem isso, qualquer correção é fé.

| ID | Tarefa | Como | Aceite | Esf. |
|---|---|---|---|---|
| F0.1 | **Reinstalar dependências limpas** | `rm -rf node_modules apps/*/node_modules && npm ci` | `npx tsc --noEmit` sai de 98 erros → ≤ 5 (resíduo real, não `.d.ts` ausente). Se persistir, investigar quarentena de antivírus/OneDrive | 0.5 d |
| F0.2 | **Scripts de verificação** | Adicionar `"typecheck": "tsc --noEmit"` e `"check": "npm run typecheck && npm run lint"` em `apps/pontufy/package.json` | `npm run check` executa e reporta | 0.2 d |
| F0.3 | **Baseline de lint** | Fotografar os 146 problemas (`npx eslint . -f json > /tmp/lint.json`) e criar `eslint-baseline.json` + `--max-warnings 0` só em arquivos novos | CI falha se o número **aumentar** | 0.3 d |
| F0.4 | **Backup do banco antes de qualquer DDL** | `pg_dump --no-owner --format=custom` do Supabase (direto, `:5432`); testar restore num banco descartável | restore validado; dump versionado fora do repo | 0.5 d |
| F0.5 | **CI mínimo (GitHub Actions)** | `install → prisma generate → typecheck → lint (baseline) → build` | workflow verde em PR; **sem** rodar migração/seed no CI | 0.5 d |
| F0.6 | **Congelar deploy + tag de segurança** | Avisar o time; `git tag pre-sec-fixes`; documentar rollback da Vercel | ninguém publica até Fase 1 fechar | 0.2 d |

**Risco a evitar:** o `build` atual executa `migrate.mjs` (que roda o auto-seed). Enquanto a F1.2 não entrar, **todo deploy re-arma o backdoor** — daí o freeze.

---

## 3. Fase 1 — Bloqueadores de segurança e dinheiro (Semana 1 · 5 d)

> Ordem interna otimizada: primeiro o que remove o risco de vida (backdoor), depois o perímetro, depois o dinheiro.

### F1.0 · Avaliação de comprometimento (paralelo, Dia 1 · 0.5 d) — **fazer antes de fechar**
Rodar em produção, somente leitura:

```sql
-- 1) o backdoor foi usado?
SELECT id, email, "createdAt", "updatedAt" FROM "User" WHERE email IN ('superadmin@pontufy.com','admin@empresaalpha.com');
SELECT * FROM "AuditLog" WHERE action IN ('LOGIN_SUCCESS','LOGIN_FAILED') AND "createdAt" > now() - interval '180 days'
  AND ("newValue"->>'role' = 'super_admin' OR "entityId" IN (SELECT id FROM "User" WHERE email LIKE '%@pontufy.com'));
-- 2) houve cunhagem de pontos?
SELECT * FROM "Commission" WHERE "commissionValue" > 1000 OR "pointsAwarded" > 10000;
SELECT * FROM "Redemption" WHERE status = 'PENDING' ORDER BY "createdAt" DESC LIMIT 50;
-- 3) saldo inconsistente com o ledger (fila de correção)
SELECT u.id, u.email, u."pointsBalance",
       COALESCE(SUM(CASE WHEN l.type='gain' THEN l."pointsAmount" ELSE -l."pointsAmount" END),0) AS ledger
FROM "User" u LEFT JOIN "PointsLedger" l ON l."userId" = u.id
GROUP BY u.id HAVING u."pointsBalance" <> COALESCE(SUM(CASE WHEN l.type='gain' THEN l."pointsAmount" ELSE -l."pointsAmount" END),0);
```

**Aceite:** relatório de 1 página dizendo se houve uso indevido e a lista de saldos divergentes. Se houver, aciona comunicação/estorno (**[DECISÃO]**).

### F1.1 · Bump de dependências com CVE crítico (0.5 d) — **primeiro PR**
`next@16.4.4` (corrige o *bypass de proxy* — que é o único gate de RBAC de páginas — e 4 RCE), `zod@4.6.6`, `next-auth` beta corrigida.
**Passos:** bump → `npm ci` → rodar app localmente → revisar changelog do Next 16.2→16.4 (breaking) → rodar smoke E2E.
**Aceite:** `npm audit --omit=dev --audit-level=high` = 0; login, dashboard, conclusão de aula e resgate funcionando manualmente.

### F1.2 · Matar o backdoor do auto-seed (0.5 d)
- `scripts/migrate.mjs:79-90`: **remover** a chamada a `check-and-seed.ts` do build.
- `scripts/check-and-seed.ts`: `if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') process.exit(0)`; trocar `update: { passwordHash }` por `update: {}` (nunca reescrever hash); senha inicial de `SEED_ADMIN_PASSWORD`, obrigatória, e só em ambiente local.
- `src/app/api/setup/seed/route.ts`: `404` quando `NODE_ENV === 'production'`; segredo próprio `SETUP_SECRET` (não `AUTH_SECRET`); remover `details: String(error)`.
- Produção: **desativar** `superadmin@pontufy.com` (ou trocar a senha para uma gerada e guardada no cofre).

**Aceite:**
```bash
# deploy (build) não cria/altera usuário
npm run build   # log não deve conter "check-and-seed" nem "PASSED"
# endpoint fechado
curl -i -X POST https://app.pontufy.com/api/setup/seed -H 'x-setup-secret: x'   # 404 em prod
# backdoor neutralizado
# login manual com superadmin@pontufy.com / 123456 deve falhar (e a conta deve estar desativada)
```

### F1.3 · Perímetro: webhooks e crons (1 d)
- **Afiliados** (`src/app/api/webhooks/affiliates/route.ts`): `if (!WEBHOOK_SECRET) return 503`; HMAC **obrigatório**; `timestamp` no payload + janela de 5 min (anti-replay); teto `commissionValue ≤ valor máximo configurado`; validar `trackingId` contra `Redemption.trackingSubId` existente (não contra `tenantId:userId` livre).
- **Postback Lomadee** (`src/domain/rewards/index.ts:199`): mover token para header (`x-pontufy-token`), comparação `timingSafeEqual`; **[DECISÃO]** pedir HMAC ao parceiro — se indisponível, IP allowlist + token de 32 bytes + idempotência.
- **Crons (4 rotas):** remover o ramo `x-vercel-cron`; exigir `Authorization: Bearer ${CRON_SECRET}`; `CRON_SECRET` obrigatório no boot (ver F2.6).

**Aceite:**
```bash
curl -i -X POST /api/webhooks/affiliates -d '{"status":"approved","commissionValue":99999,...}'   # 503 sem secret / 401 com assinatura errada
curl -i /api/cron/expire-points -H 'x-vercel-cron: 1'                                            # 401
curl -i /api/cron/expire-points -H "Authorization: Bearer $CRON_SECRET"                          # 200 (só com o segredo)
```

### F1.4 · Dinheiro: preço server-side + débito atômico (1.5 d)
1. **Remover `pointsCost`** de `redeemSchema` e de `RedeemInput`; resgate de produto exige `rewardId` (preço vem de `Reward.pricePoints`). Validar `validateAffiliateUrl` em **todos** os caminhos.
2. **`debitPoints` com update condicional** (`src/domain/points/index.ts`):
```ts
const r = await tx.user.updateMany({
  where: { id: userId, tenantId, pointsBalance: { gte: amount } },
  data:  { pointsBalance: { decrement: amount } },
});
if (r.count === 0) throw new PointsError('Saldo insuficiente.', 'INSUFFICIENT_BALANCE');
```
3. **Migração com checkpoint de saldo negativo** (`prisma/migrations/2026XXXX_user_points_nonneg`):
```sql
-- 1. saneamento (idempotente, roda antes da constraint)
UPDATE "User" SET "pointsBalance" = 0 WHERE "pointsBalance" < 0;
-- 2. constraint sem lock longo
ALTER TABLE "User" ADD CONSTRAINT "User_pointsBalance_nonneg" CHECK ("pointsBalance" >= 0) NOT VALID;
ALTER TABLE "User" VALIDATE CONSTRAINT "User_pointsBalance_nonneg";
```
4. **Lock com fencing**: `releaseLock`/`extendLock` devem comparar o `lockValue` no Lua (`if redis.call("GET",KEYS[1]) == ARGV[1] then ...`); TTL maior que o timeout total (e `AbortSignal.timeout(8000)` no fetch da Lomadee, que hoje roda **dentro** da transação — mover para fora).
5. **Redis deixa de ser requisito de correção:** com o débito condicional, o lock vira otimização. `acquireLock` sem Redis deve **permitir** a operação (hoje retorna `false` → 429 permanente).

**Aceite:** teste de concorrência (10 resgates simultâneos com saldo para 1) → exatamente 1 sucesso, 9 × `INSUFFICIENT_BALANCE`, saldo final 0 e **nunca negativo**. Teste roda no CI sem Redis.

### F1.5 · Certificados (0.5 d)
- `CERTIFICATE_VERIFICATION_SECRET` obrigatório (throw no boot); remover o fallback `'pontufy-cert-secret-dev'`.
- Payload canônico: `JSON.stringify` de objeto com chaves ordenadas (nada de `join('|')`); `timingSafeEqual`.
- **Persistir o payload assinado**: coluna `signedPayload Json` em `IssuedCertificate` (migração) e verificar contra ela — nunca reconstruir com defaults.
- Corrigir `verify/[certificateId]/page.tsx` (hoje valida com `workloadHours: 0, lessonCount: 0`).

**Aceite:** emitir certificado → `/verify/<id>` mostra **"Certificado Válido"**; alterar 1 byte no payload → "Inválido"; teste automatizado cobre os dois casos.

### F1.6 · Rotação de segredos e invalidação de sessões (0.5 d)
Rotacionar, nesta ordem: `AUTH_SECRET` (invalida **todas** as sessões — bom), `CRON_SECRET`, `LOMADEE_POSTBACK_SECRET`, `CERTIFICATE_VERIFICATION_SECRET`, `STRIPE_WEBHOOK_SECRET` (recriar no dashboard da Stripe), senha do banco se houver suspeita.
**Aceite:** segredos novos em Production **e** Preview; nenhum segredo em log; `.env.example` atualizado com os 4 nomes que faltavam.

### F1.7 · Prova de que está fechado (1 d)
Adicionar 4 testes de regressão (Playwright/API, no estilo do `tests/api/*` já existente): `sec-affiliate-webhook-fail-closed`, `sec-cron-header-bypass`, `money-no-negative-balance`, `money-client-controlled-price`.
**Gate da fase:** 4 testes verdes + auditoria sem CVE alto/crítico + checklist de F1.0 respondido.
**Saída:** *unfreeze* do deploy com aprovação explícita.

---

## 4. Fase 2 — Integridade e confiabilidade (Semanas 2–3 · 9 d)

### Onda 2A — Dinheiro e fluxos (5 d)
| ID | Tarefa | Arquivos | Aceite | Esf. |
|---|---|---|---|---|
| F2.1 | **Stripe: máquina de estados de idempotência** (`processing`/`processed`/`failed`; reprocessa se `!= processed`) | `webhooks/stripe/route.ts`, schema | evento válido de `checkout.session.completed` ativa plano; falha simulada → retry processa de novo | 1.5 d |
| F2.2 | **Lomadee sync seguro** — abortar se catálogo vazio, paginar de verdade, desativar por `updatedAt < cutoff`, `@@unique([partner, externalId])` | `cron/sync-lomadee`, `infra/lomadee.ts`, schema | catálogo de 200 itens continua íntegro após sync; resposta vazia → 500 e nada desativado | 1.5 d |
| F2.3 | **Corridas de quiz e batalha** — `updateMany` condicional para "primeiro passe" e para reservar turno; `$transaction` no turno | `domain/learning`, `domain/battles`, schema | 2 requisições simultâneas ⇒ +50 pontos **uma vez**; turno duplo ⇒ departamento creditado uma vez | 1 d |
| F2.4 | **`lessons/sync` correto** — `createManyAndReturn`/`RETURNING` em vez de `slice(0, count)`; reaproveitar `completeLesson` | `api/lessons/sync` | [duplicada, nova] credita só a nova, com valor certo | 0.5 d |
| F2.5 | **Expiração correta (fix mínimo)** — não expirar pontos novos por dívida antiga; `type` documentado; paginação no `findMany`; `Math.min` dentro da transação | `cron/expire-points` | cenário "gastou ganho antigo + ganhou novo" não perde o novo | 0.5 d |

### Onda 2B — Isolamento, deploy e resiliência (4 d)
| ID | Tarefa | Arquivos | Aceite | Esf. |
|---|---|---|---|---|
| F2.6 | **Validação de env no boot** (`src/infra/env.ts` com Zod; falha rápido, separa required/optional) | novo + `instrumentation.ts` | subir sem `AFFILIATE_WEBHOOK_SECRET` falha no start com mensagem clara | 1 d |
| F2.7 | **`migrate.mjs` fail-closed + migração fora do build** | `scripts/migrate.mjs`, `vercel.json`, CI | migração falha ⇒ pipeline vermelho; deploy não aplica schema | 1 d |
| F2.8 | **Interceptor: `upsert` e `OR`** — tratar `upsert` (where+create), `AND` em vez de sobrescrever `OR`; teste de contrato por modelo | `infra/db.ts` | teste por modelo prova que todo acesso é escopado | 0.75 d |
| F2.9 | **SSE por usuário** (`sse:${tenantId}:${userId}`) + mover `broadcastToTenant` para `infra/` | `notifications/stream`, `lib/notifications` | usuário A não recebe evento de B (teste) | 0.5 d |
| F2.10 | **Service Worker sem HTML autenticado** + `VERSION` por build + limpar cache no logout | `public/sw.js`, logout | offline não serve `/dashboard` de sessão anterior | 0.5 d |
| F2.11 | **Rate limit nas rotas públicas** (`tenants/onboarding`, `invitations/accept`) + política de sessão (revogação sem Redis) | rotas + `auth.ts` | 11ª tentativa em 15 min ⇒ 429; revoke-all funciona sem Redis | 0.5 d |

**Gate da fase:** suíte de concorrência (`concurrency-points`, ampliada) verde **sem Redis**; isolamento com teste por modelo; pipeline falha quando a migração falha.

---

## 5. Fase 3 — Qualidade contínua e produto (Semanas 4–6 · 12 d)

### Onda 3A — Engenharia (5 d)
1. **CI bloqueante**: `tsc` + `lint` (baseline → 0) + `vitest` + `build` + `playwright` (com Postgres de serviço, sem banco compartilhado).
2. **Testes unitários de domínio** (Vitest): `points`, `learning`, `rewards`, `battles`, `certificates` — meta 40+, com os cenários de corrida como `it.each`.
3. **Observabilidade**: `instrumentation.ts` + Sentry (`onRequestError`), `requestId` no logger, `LOG_LEVEL`, `/api/health` (DB+Redis, sem auth, sem LLM) e aposentar `/api/ai/health` como probe.
4. **Headers de segurança** em `next.config.ts`: CSP (com nonce), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
5. **Higiene**: remover `@supabase/supabase-js` e `lightningcss`; unificar os SDKs de IA em `ai-providers`; remover código morto (`signed-urls.ts`, `cron/rewards-sync`, shims de 1 linha); `escapeHtml` nos e-mails; `mapPrismaError`.

### Onda 3B — Produto (4 d)
1. **Corrigir a tela de resgate**: eliminar o cupom falso (`Math.random()`), usar o `CheckoutDrawer` de `components/rewards`, `Toast` no lugar de `alert()`, estado vindo do servidor.
2. **Consolidar design system**: uma única família de `Card`/`Drawer`/`Grid`; eliminar `marketplace/*` duplicado.
3. **RSC**: migrar `/dashboard`, `/cursos`, `/wallet`, `/profile` para Server Components + Server Actions (mata 4 waterfalls).
4. **Landing**: corrigir `VITE_APP_URL` (CTA de login aponta para a própria landing hoje), `robots.txt`/`sitemap.xml`, `canonical`/`og:url` absoluto, JSON-LD, dividir `translations.ts`.

### Onda 3C — Dívida estrutural (3 d)
Enums Prisma (`role`, `plan`, `contractStatus`, `status`, `type`) com migração de dados; `quizJson`/`questionsJson` → `Json`; soft delete onde faz sentido; `PointsLot` completo (expiração por lote, reversível) substituindo o fix mínimo da F2.5; paginação nos `findMany` sem `take`.

---

## 6. Backlog (não agendado — reavaliar a cada fase)

- Superadmin em tabela própria (`PlatformAdmin`), desacoplado de `User`/`Tenant`.
- `packages/{ui,tokens,config}` + Turborepo (hoje `lucide-react` está em 2 majors diferentes entre landing e app).
- Migrar Prisma 5 → 6/7 (o 5 está em fim de linha).
- `jspdf` fora do bundle da rota de certificados.
- Revisão de `skills-lock.json` (hashes não conferem) e remoção de `apps/landing/.claude/settings.local.json` do repo.
- Acessibilidade: `aria-label` em botões de ícone, foco em drawers, contraste.

---

## 7. Cadência, PRs e release

- **Diário:** 15 min de sincronização — o que fechou, o que travou, risco novo.
- **PR por tarefa** (F1.x, F2.x…), revisão obrigatória de uma segunda pessoa nos PRs de dinheiro e auth.
- **Branch:** `sec/<id>`· `fix/<id>` · `chore/<id>`; merge com squash; tag por fase (`v0.2-sec`, `v0.3-integrity`).
- **Release:** Preview → smoke manual (login, aula, resgate, certificado) → Production. Migração aplicada **fora** do build (F2.7) a partir da Fase 2.
- **Rollback:** Vercel "instant rollback" + `pg_dump` diário; migrações sempre *expand/contract* (nunca `DROP COLUMN` no mesmo deploy do código).

---

## 8. Riscos, dependências externas e decisões pendentes

| # | Item | Tipo | Impacto se não resolvido | Dono | Quando |
|---|---|---|---|---|---|
| R1 | **Lomadee não oferece HMAC no postback** | Externo | F1.3 fica com token em header + IP allowlist (mitigação parcial) | Produto/Parceria | Semana 1 |
| R2 | **Rotação de `AUTH_SECRET` derruba todos os usuários** | Operacional | Comunicar antes; janela de 15 min fora do horário comercial | Ops | F1.6 |
| R3 | **Saldo negativo já existente no banco** | Dado | `UPDATE ... SET 0` antes da constraint (F1.4) — exige aceite financeiro | **[DECISÃO]** | F1.4 |
| R4 | **Backdoor pode ter sido usado** | Segurança | Relatório F1.0; se sim, comunicação a clientes (LGPD, prazo de 72 h) | **[DECISÃO]** | Dia 1 |
| R5 | **`node_modules` corrompido** | Ambiente | Se `npm ci` não resolver, investigar antivírus/OneDrive sincronizando a pasta | Dev | F0.1 |
| R6 | **Redis vira obrigatório ou não** | Arquitetura | **[DECISÃO]** — recomendação: obrigatório para rate limit/lockout, opcional para o core (após F1.4) | Tech lead | Fase 2 |
| R7 | **Migração `slug NOT NULL` pode já ter falhado em prod** | Dado | Conferir `_prisma_migrations` no dia 1 (junto com F1.0) | Dev | Dia 1 |

**Decisões que precisam de resposta antes do fim da Semana 1:** R3, R4, R6. As demais não bloqueiam.

---

## 9. Definition of Done (vale para toda tarefa)

- [ ] Código revisado por uma segunda pessoa
- [ ] Teste automatizado que falha sem a correção e passa com ela
- [ ] `npm run check` (typecheck + lint) verde
- [ ] Sem novo `console.*`, sem novo `any`, sem segredo em log
- [ ] Documentação tocada se o comportamento mudou (`CLAUDE.md`, `.env.example`, `PRODUCTION.md`)
- [ ] Passo de verificação manual descrito no PR (comando/URL + resultado esperado)
- [ ] Rollback possível (feature flag ou revert limpo)

---

## 10. Primeiros 5 dias, em ordem

| Dia | Manhã | Tarde |
|---|---|---|
| **1** | F0.1 reinstalar deps · F0.4 backup · **F1.0 forense (paralelo)** · checar `_prisma_migrations` | F1.1 bump `next`/`zod`/`next-auth` + smoke manual |
| **2** | F0.5 CI mínimo · F0.6 freeze + tag | F1.2 remover auto-seed + fechar `/api/setup/seed` + desativar superadmin |
| **3** | F1.3 webhooks fail-closed + HMAC + replay | F1.3 crons só Bearer |
| **4** | F1.4 remover `pointsCost` + `debitPoints` condicional | F1.4 migração `CHECK` + auditoria de saldos negativos |
| **5** | F1.5 certificados (payload assinado + verificação) | F1.6 rotação de segredos · F1.7 4 testes de regressão · **gate da fase** |

**No fim do dia 5:** os 4 vetores de ataque do relatório estão neutralizados, os segredos rotacionados, o backdoor desativado, os CVE críticos corrigidos e a produção pode voltar a receber deploy — com evidência, não com fé.

---

## Anexo — Como medir se o plano funcionou

| Métrica | Antes | Semana 2 | Semana 6 |
|---|---|---|---|
| CVEs alto/crítico | 10 | 0 | 0 |
| Vetores de forja/perda de pontos abertos | 3 | 0 | 0 |
| Saldo negativo possível | sim | não | não |
| Migração falhada passa no deploy | sim | não | não |
| Erros de ESLint | 146 | ≤ 146 (congelado) | 0 |
| Testes automatizados | 44 (0 unit.) | 48+ | 90+ |
| Endpoints públicos sem rate limit | 3 | 3 | 0 |
| Tempo de detecção de falha de deploy | ∞ | < 5 min | < 5 min |
