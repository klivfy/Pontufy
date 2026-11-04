# Pontufy — Diagnóstico técnico e plano de melhorias

**Data:** 02/11/2026 · **Escopo:** monorepo `Pontufy` (`apps/pontufy`, `apps/landing`, `archive/`)
**Plano de execução derivado deste diagnóstico:** [PLANO-DE-ACAO.md](PLANO-DE-ACAO.md)
**Execução da Fase 0 + Fase 1 (7 P0 fechados):** [EXECUCAO-FASE-1.md](EXECUCAO-FASE-1.md)
**Método:** leitura estática completa do código, execução de `tsc --noEmit`, `eslint`, `npm audit`, inspeção de schema/migrações, rotas, testes e pipeline de deploy. Nenhum arquivo do projeto foi alterado durante a análise (os dois documentos são os únicos artefatos novos).

---

## 1. Sumário executivo

O Pontufy é um SaaS B2B tecnicamente **acima da média para um MVP**: a separação `app/api → domain → infra` é real (não é só pasta bonita), existe um interceptor multi-tenant central, criptografia de senha canônica, validação Zod centralizada, auditoria append-only e uma suíte E2E com fixtures determinísticas. A maior parte do "core" está no lugar certo.

O problema não é arquitetura — é **confiança**. O sistema move dinheiro (pontos → recompensas reais via Lomadee) e hoje tem **7 falhas que permitem criar, duplicar ou gastar pontos indevidamente**, sendo 3 exploráveis por qualquer pessoa na internet sem credencial. Em paralelo, o pipeline de deploy transforma qualquer falha de infraestrutura em incidente silencioso: migração falha e o deploy passa mesmo assim, e um seed roda em produção **redefinindo a senha do `super_admin` para `123456` a cada deploy**.

| Dimensão | Estado | Comentário |
|---|---|---|
| Arquitetura / organização | 🟢 Bom | Camadas reais, domínio testável, convenções documentadas |
| Isolamento multi-tenant | 🟡 Razoável | Boa ideia, 3 buracos concretos (`upsert`, `OR` sobrescrito, `createMany` aninhado) |
| Integridade financeira (pontos) | 🔴 Crítico | Saldo denormalizado sem `CHECK`, débito read-then-update, preço vindo do cliente |
| Segurança de webhooks/cron | 🔴 Crítico | 1 endpoint credita pontos sem assinatura; 4 crons aceitam header forjável |
| Gestão de segredos/segredos default | 🔴 Crítico | `AUTH_SECRET` usado como API key, HMAC de certificado com default público |
| Dependências | 🔴 Crítico | 4 CVEs críticos ativos (Next RCE, Auth.js fail-open) |
| Testes | 🟡 Razoável | 8 specs / 44 testes E2E+API (bons), **zero** unitário; dependem de Postgres+Redis reais |
| CI/CD | 🔴 Inexistente | Sem GitHub Actions, sem gate de lint/typecheck; 109 erros de ESLint no repo |
| Observabilidade | 🟡 Razoável | `logger` existe, mas 78 `console.*` fora dele, sem request-id, sem Sentry |
| Frontend/UX | 🟡 Razoável | MD3 consistente em parte, mas duplicação e telas que "mentem" para o usuário |
| Documentação | 🟡 Razoável | `CLAUDE.md` é excelente; `README`/`deploy-guide` estão desatualizados/errados |

**Veredito:** não faça um novo deploy em produção antes de resolver a seção 3 (P0). O esforço é de **~2 a 4 dias** e elimina as falhas exploráveis por terceiros. O restante (seção 4 e 5) pode e deve entrar num plano de 3 sprints.

---

## 2. O que é o sistema (mapa rápido)

```
apps/pontufy        Next.js 16.2.9 · React 19 · Prisma 5 · PostgreSQL (Supabase) · NextAuth v5 beta
  src/proxy.ts      gate RBAC declarativo (o antigo middleware.ts)
  src/domain/*      regras de negócio (auth, learning, points, rewards, battles, skills, engagement, billing)
  src/infra/*       adapters (db com interceptor de tenant, redis, email, stripe, lomadee, crypto, logger)
  src/app/*         34 páginas + 63 rotas de API
apps/landing        Vite + React (site institucional) · i18n de 69 KB em um único arquivo
archive/            experimento v2 descontinuado (fora dos workspaces)
```

Números do código: **251 arquivos** `.ts/.tsx`, **~21 mil linhas**, 63 rotas de API, 34 páginas, **17 das 34 páginas são `'use client'`** (76 arquivos com `'use client'` no total), 8 specs de teste, 2 apps, 0 pipeline de CI.

### O que já está bem (não regredir)

1. **Interceptor multi-tenant por modelo** (`src/infra/db.ts`) — `STRICT_TENANT_MODELS` injeta `tenantId` em leitura/escrita, `Lesson` é escopada por relação (`course.tenantId`), `Reward` implementa corretamente o modelo híbrido global+tenant. É a peça mais bem pensada do backend.
2. **Criptografia de senha canônica** (`src/infra/crypto.ts`) — scrypt com salt de 16 B, chave de 64 B, `salt:hash` e `timingSafeEqual`, com regra explícita de não reimplementar.
3. **Padrão atômico já implementado no lugar certo** (`src/actions/course-generator.ts`) — débito de crédito de IA com `updateMany({ where: { aiCredits: { gte: 1 } } })` + `if (count === 0) throw`. É exatamente o que falta em `debitPoints`; a receita já existe no repo.
4. **Stripe valida assinatura sobre o corpo cru** (`webhooks/stripe/route.ts`) — `request.text()` + `constructEventAsync`, nunca re-serializa.
5. **Auditoria e validação pensadas** — `logAudit` com intenção append-only, Zod centralizado em `src/lib/validations`, `jsonError` que não vaza stack para o cliente.
6. **Suíte de testes honesta** — `tests/` tem cenários que a maioria dos MVPs não tem: `tenant-isolation`, `concurrency-points`, `webhooks-integrity`, `superadmin-gate`, `malicious-payloads`. Os nomes mostram que alguém pensou em ameaças reais.

---

## 3. P0 — Bloqueadores (corrigir antes do próximo deploy)

> Todas as 7 têm exploit concreto. Esforço total estimado: **2–4 dias**.

### P0-1 · `super_admin` com senha `123456` recriada em **todo deploy**

`package.json:7` → `scripts/migrate.mjs:86` → `scripts/check-and-seed.ts:61-98`

```json
"build": "prisma generate && node scripts/migrate.mjs && next build"
```
```ts
execSync('npx tsx scripts/check-and-seed.ts', { stdio: 'inherit', env });  // migrate.mjs:86
const passwordHash = hashPassword('123456');                                // check-and-seed.ts:61
update: { passwordHash, tenantId: platformTenant.id },                      // :90 → superadmin@pontufy.com
```

O `build` da Vercel roda isso em **produção**. O `update` reescreve o hash: se um humano trocou a senha, o próximo deploy volta para `123456`. Como o gate de superadmin é apenas `role === 'super_admin'` + e-mail `@pontufy.com` (`src/proxy.ts:91-93`), isso é takeover total da plataforma com credencial de conhecimento público.

**Correção**
- Remover `check-and-seed.ts` do `build` (`if (process.env.VERCEL_ENV === 'production') process.exit(0)`), mover para script manual.
- Nunca `update` de `passwordHash` em seed — usar `onConflict: 'do nothing'` + `SEED_ADMIN_PASSWORD` obrigatório.
- Separar superadmin de `User` de tenant (tabela `PlatformAdmin`), para não depender de `tenantId` sintético.

---

### P0-2 · Webhook de afiliados credita pontos **sem autenticação** se o secret não existir

`src/app/api/webhooks/affiliates/route.ts:6,46-51,91-98` + `src/domain/rewards/index.ts:231-234`

```ts
const WEBHOOK_SECRET = process.env.AFFILIATE_WEBHOOK_SECRET || '';
if (WEBHOOK_SECRET) { const valid = await verifyHmac(...); if (!valid) return 401; }
...
const pointsAwarded = event.status === 'approved' && event.commissionValue > 0
  ? Math.round(event.commissionValue * 10) : 0;
```

`AFFILIATE_WEBHOOK_SECRET` **não aparece no `.env.example`** (que documenta todas as outras 24 chaves) — logo, na prática, não está configurado. Sem ele, `verifyHmac` nunca roda e qualquer `POST` anônimo com:

```json
{ "network":"x", "trackingId":"<tenantId>:<userId>:0", "orderId":"x",
  "status":"approved", "commissionValue":999999 }
```

cria `Commission` + **~10 milhões de pontos** convertíveis em recompensa real. Fraude direta, sem privilégio algum.

**Correção:** fail-closed (`if (!WEBHOOK_SECRET) return 500`), HMAC obrigatório, teto de `commissionValue` validado contra o catálogo, e crédito idempotente por `orderId` com status monotônico.

---

### P0-3 · Preço do resgate vem do **cliente** (`pointsCost`)

`src/lib/validations/index.ts:57` + `src/domain/rewards/index.ts:64-65,151-157`

```ts
pointsCost: z.number().int().nonnegative().max(1_000_000).optional(),  // validações
...
amount: pointsCost,                                                    // débito
```

`{ "productUrl": "https://www.amazon.com.br/ps5", "pointsCost": 1 }` debita **1 ponto** e emite `Redemption` com link de afiliado válido. Além disso, `redeemLomadeeProduct` **não** chama `validateAffiliateUrl` (só `redeemCatalog` chama), aceitando qualquer host — o link persistido é devolvido ao usuário.

**Correção:** remover `pointsCost` do contrato público. Resgate só por `rewardId` de catálogo (preço = `Reward.pricePoints`, server-side) ou resolução via `LomadeeService.fetchOffer(id)`. Validar URL em **todos** os caminhos.

---

### P0-4 · Duplo gasto de pontos: read-then-update + ausência de `CHECK`

`src/domain/points/index.ts:44-52` · `prisma/schema.prisma:64` · `src/infra/mutex.ts:3-27`

```ts
const user = await tx.user.findFirst({ where: { id: params.userId } });
if (user.pointsBalance < params.amount) throw new PointsError(...);
const updatedUser = await tx.user.update({ where: { id: params.userId },
  data: { pointsBalance: { decrement: params.amount } } });
```

Em `READ COMMITTED` (padrão) isso não serializa: duas requisições leem `100`, ambas passam na checagem, ambas decrementam → **`-100`**. Nenhuma das 9 migrações cria `CHECK ("pointsBalance" >= 0)`. A única barreira é o lock Redis, que tem três furos:

1. TTL de **10 s**, enquanto o `fetch` para a Lomadee roda **dentro** da transação e **sem timeout** — o lock expira no meio da operação.
2. `releaseLock` apaga a chave **sem comparar o `lockValue`** (`mutex.ts:15-23`, o Lua só testa `EXISTS`) — a requisição A pode liberar o lock da requisição B.
3. Sem Redis, `acquireLock` retorna `false` → **429 permanente** (ver P1-10).

**Correção** (padrão que o repo já usa em `course-generator.ts:376-382`):

```ts
const r = await tx.user.updateMany({
  where: { id: userId, tenantId, pointsBalance: { gte: amount } },
  data:  { pointsBalance: { decrement: amount } },
});
if (r.count === 0) throw new PointsError('Saldo insuficiente.', 'INSUFFICIENT_BALANCE');
```

\+ migração `ALTER TABLE "User" ADD CONSTRAINT "User_pointsBalance_nonneg" CHECK ("pointsBalance" >= 0);`
\+ lock com fencing token (comparar `lockValue` no Lua) e TTL maior que o timeout total do request.

---

### P0-5 · Certificado: segredo default público e verificação que **nunca** valida

`src/lib/certificate-generator.ts:33,165,172` · `src/app/verify/[certificateId]/page.tsx:46-61` · `src/lib/certificate-service.ts:70-98`

```ts
const VERIFICATION_SECRET = process.env.CERTIFICATE_VERIFICATION_SECRET || 'pontufy-cert-secret-dev'; // :33
const payload = [data.verificationHash, ...].join('|');   // sem escape → colisão
return expected === data.signature;                        // não constant-time
```

Dois problemas independentes:
- `CERTIFICATE_VERIFICATION_SECRET` **não está no `.env.example`** → o fallback público tende a ser o segredo real; qualquer um forja assinatura.
- O emissor assina `completionDate` (data da última conclusão), `workloadHours` e `lessonCount` reais, mas a verificação usa `certificate.issuedAt` e **`workloadHours: 0, lessonCount: 0` hardcoded** (`verify/page.tsx:56-57`). Resultado: **todo certificado legítimo é exibido como "Certificado Inválido"**.

**Correção:** segredo obrigatório (throw se ausente), payload JSON canônico com chaves ordenadas, `timingSafeEqual`, e persistir o payload assinado (`signedPayload Json`) em `IssuedCertificate` para a verificação recomputar exatamente o que foi assinado.

---

### P0-6 · Crons destrutivos aceitam header forjável

`src/app/api/cron/{expire-points,link-health,rewards-sync,sync-lomadee}/route.ts`

```ts
const isVercelCron = vercelCronHeader === '1';
const isAuthorized = isVercelCron || (cronSecret && authHeader === `Bearer ${cronSecret}`);
```

Qualquer requisição externa com `x-vercel-cron: 1` executa:
- **`expire-points`** → expira pontos de **todos os tenants**;
- **`link-health`** → desativa recompensas do catálogo global;
- **`sync-lomadee`** → desativa o catálogo inteiro (ver P1-4).

O `CRON_SECRET` existe no `.env.local` e é ignorado quando o header está presente. O commit `7e43886 debug(cron): ... desabilita auth temporariamente` mostra que essa porta já foi aberta de propósito e ficou.

**Correção:** exigir **apenas** `Authorization: Bearer ${CRON_SECRET}` (o Vercel envia esse header nativamente). Se precisar aceitar o header da Vercel, condicionar a `process.env.VERCEL === '1'` **e** manter o Bearer.

---

### P0-7 · Dependências com CVE crítico ativo

`npm audit --omit=dev` → **18 vulnerabilidades: 4 críticas, 6 altas**

| Pacote | Versão | Crítico | Correção |
|---|---|---|---|
| `next` | 16.2.9 | RCE não autenticado na Image Optimization (SVG e AVIF), RCE em `next/og`, RCE em `use cache`, **bypass de proxy/middleware** (GHSA-6gpp-xcg3-4w24) | **16.4.4** |
| `next-auth` / `@auth/core` | 5.0.0-beta.31 | *fail-open* de checagem de auth em erro de configuração; bypass de normalização de e-mail (homoglyph `@`) | beta corrigida |
| `dompurify` | transitivo | XSS via `SAFE_FOR_TEMPLATES` | bump |
| `zod` | 4.4.3 | exaustão de memória em coleções grandes (usado em **todas** as entradas) | 4.6.6 |
| `sharp`, `nanoid`, `postcss` | transitivos | — | bump via `next` |

O CVE de **bypass de proxy** é diretamente aplicável: `src/proxy.ts` é o único gate de RBAC de páginas. E o *fail-open* do Auth.js combina com o padrão do P0-1 (config errada → sessão válida).

**Correção:** `npm i next@16.4.4 zod@4.6.6` + bump do `next-auth`, e adicionar `npm audit --audit-level=high` no CI.

---

## 4. P1 — Integridade, confiabilidade e isolamento

### P1-1 · Stripe marca o evento como processado **antes** de processar
`src/app/api/webhooks/stripe/route.ts:44-61,254` — o `StripeEvent.create` acontece antes do `switch`. Se o processamento lançar (500), o evento **já está commitado**; o retry do Stripe cai em `if (existing) return { duplicate: true }` e o evento **nunca é processado**. Assinatura paga sem plano/créditos ativados.
**Fix:** coluna `status` (`processing|processed|failed`); reprocessar quando `status != 'processed'`; ou processar primeiro e usar `eventId` como chave de idempotência das escritas.

### P1-2 · Sincronização Lomadee desativa o catálogo inteiro
`src/app/api/cron/sync-lomadee/route.ts:96-108` + `src/infra/lomadee.ts:370-374` — o cron calcula `activeExternalIds` a partir de `fetchCatalog()` que usa `results: '50', page: '1'` **hardcoded** e tolera falha parcial (`Promise.allSettled`). Depois faz `updateMany({ externalId: { notIn: activeExternalIds } })`. Consequência: catálogo vazio, resposta parcial ou simplesmente **>50 ofertas** ⇒ todo o resto é desativado. A loja se esvazia sozinha de madrugada.
**Fix:** abortar com 500 se o catálogo vier vazio; paginar de verdade; desativar por `updatedAt < cutoff` (não por `notIn`); `@@unique([partner, externalId])` para impedir duplicação em crons concorrentes.

### P1-3 · Postback Lomadee: token na query string, sem HMAC e sem crédito
`src/app/api/postback/lomadee/route.ts:9` + `src/domain/rewards/index.ts:199-203,296-311` — token estático em `?token=` (vaza em access log/CDN), comparação `!==` (não constant-time), sem assinatura do corpo nem timestamp/nonce (replay). E o caminho canônico cria `Commission` com `pointsAwarded: 0` e **nunca credita**, enquanto `persistCommission` credita — dois pipelines divergentes para o mesmo domínio.
**Fix:** HMAC do corpo cru (padrão já existente em `webhooks/affiliates`), token em header, idempotência monotônica por `(orderId, status)` e um único serviço de comissão.

### P1-4 · Auditoria do cron nunca é gravada
`src/app/api/cron/sync-lomadee/route.ts:112-126` grava `tenantId: 'system'`, que viola a FK `AuditLog_tenantId_fkey`; `logAudit` engole o `P2003` (`src/lib/audit.ts:39-42`). A trilha "SOC2/LGPD" prometida no comentário do arquivo não contém o registro de sincronização.
**Fix:** `AuditLog.tenantId` nullable (eventos de plataforma) ou tenant `system` realmente semeado; e `logAudit` deve propagar erro em operações críticas (ou gravar em outbox).

### P1-5 · Corridas que duplicam crédito
- **Quiz:** `learning/index.ts:172-193` checa "primeiro passe" com `findFirst` e credita +50 fora de qualquer constraint — duas requisições concorrentes creditam duas vezes.
- **Batalhas:** `domain/battles/engine.ts:287-301` lê o turno, faz dois `update` separados e depois `creditDepartmentPoints` fora de transação (`:323-326`) — turno duplo credita o departamento duas vezes.
**Fix:** `@@unique([userId, courseId])` para o "primeiro passe" (ou coluna `bonusAwardedAt`) com `updateMany` condicional; em batalha, reservar o turno com `updateMany({ where: { id, [coluna]: null } })` + `$transaction`.

### P1-6 · Expiração de pontos sem rastreio por lote
`src/app/api/cron/expire-points/route.ts:22-32,65-92` — expira por heurística agregada (`sum(gains > 12m) - sum(expirations)`), não por lote:
- ganhos **já gastos** continuam na conta ⇒ a expiração consome pontos **novos** para pagar dívida antiga;
- `Math.min(toExpire, pointsBalance)` é lido fora da transação ⇒ pode negativar o saldo;
- `type: 'expiration'` está fora do vocabulário documentado (`gain`/`loss`) e é **ignorado** por `admin/analytics` (`route.ts:38-39`) e pela UI (`PointsHistory.tsx:6`);
- `findMany` sem `take` carrega o ledger inteiro na memória de um serverless.

**Fix:** `PointsLot` (`userId, amount, remaining, expiresAt, sourceLedgerId`), expiração por lote com `updateMany({ where: { id, remaining: { gte: n } } })`, lançamento com `sourceLotId` (reversível) e processamento em páginas.

### P1-7 · Buraco no interceptor "Zero Trust"
`src/infra/db.ts:66-79,182-198` — `upsert` **não** está em `READ_OPS`/`WRITE_OPS` nem no branch de `create`, então passa direto sem injeção de `tenantId` (usado em `certificate-service.ts:100` e `skills/tree.ts:147,177`). Hoje o risco prático é baixo (as chaves incluem `userId` da sessão), mas a garantia declarada no arquivo é falsa.
`src/infra/db.ts:138-141` também **sobrescreve** o `where.OR` do chamador, mudando a semântica da query silenciosamente.
**Fix:** tratar `upsert` explicitamente (`where` + `create`), usar `AND: [...(where.AND ?? []), { OR: [...] }]`, e adicionar teste de contrato por modelo.
**Bônus:** `admin/skills/pdi` valida `userId` apenas como UUID (`route.ts:9-12`) — um `admin_rh` pode criar PDI para usuário de outro tenant. Validar vínculo `User.tenantId` no domínio.

### P1-8 · `lessons/sync` credita a aula errada
`src/app/api/lessons/sync/route.ts:79-113` — `createMany({ skipDuplicates: true })` não garante que as linhas ignoradas sejam as últimas; `validItems.slice(0, created.count)` pode creditar a aula **duplicada** e nunca a nova, gravando ledger com descrição e valor errados. Além disso o caminho offline ignora `burstMultiplier`, `checkVelocityLimit` e notificações — regra de negócio duplicada e divergente de `completeLesson`.
**Fix:** `createManyAndReturn` (Postgres `RETURNING`) ou `create` por item capturando `P2002`; e reutilizar `completeLesson` como único caminho de crédito.

### P1-9 · Redis "opcional" quebra as duas jornadas centrais
`.env.example` lista Upstash como *"optional integrations (features degrade gracefully if unset)"*. Na prática:
- `acquireLock` retorna `false` sem Redis → **concluir aula e resgatar recompensa respondem 429 sempre** (`mutex.ts:5`, `redeem/route.ts:37`, `lessons/complete/route.ts:37`);
- rate limit e lockout viram **no-op** (`rateLimitCheck` → `allowed: true`) ⇒ `register`, `forgot-password` e login sem proteção nenhuma;
- SSE e contadores de notificação degradam.

O `.env.local` deste checkout **não tem `DATABASE_URL` nem Upstash** — ou seja, em desenvolvimento não é possível concluir uma aula nem resgatar nada.
**Fix:** (a) aplicar P0-4 — com débito condicional, o lock deixa de ser requisito de correção e o Redis volta a ser otimização; (b) fail-closed **no boot** para controles de segurança (validação de env com Zod), em vez de degradar em silêncio; (c) documentar Redis como obrigatório para produção.

### P1-10 · `migrate.mjs` fail-soft congela o schema em silêncio
`scripts/migrate.mjs:67-77` engole falha do `prisma migrate deploy` e deixa o `next build` continuar. Combinado com `20260814000000_sync_current_schema/migration.sql:24` (`ADD COLUMN "slug" TEXT NOT NULL` **sem default**) e `:36-37` (duas `DROP COLUMN` em `AuditLog`), o cenário é: migração aborta, deploy passa, app sobe com schema divergente e o Prisma marca a migração como `failed` — **todos** os deploys seguintes falham nela, sem alarme.
**Fix:** `process.exit(1)` no catch; migração em 3 passos (nullable → backfill → `SET NOT NULL`, como já é feito corretamente em `20260630000000`); backup antes de DDL destrutiva.

### P1-11 · Superfície pública sem rate limit
`src/app/api/tenants/onboarding/route.ts` — endpoint **público** que cria tenant + admin, sem rate limit e sem Zod. Vetor de spam de trial, poluição de banco e envio de e-mail em massa (`sendWelcomeEmail`, `:137`). `invitations/accept` também é público e sem limite.
**Fix:** rate limit por IP + captcha/honeypot, Zod, e verificação de e-mail antes de provisionar.

### P1-12 · SSE entrega notificações de **todos** os usuários do tenant
`src/lib/notifications.ts:52-58` → `src/app/api/notifications/stream/route.ts:14-22,34,57` — o canal é `sse:${tenantId}` (um por empresa) e o payload inclui `message` e `link` de um usuário específico:

```ts
broadcastToTenant(payload.tenantId, 'notification', {
  userId: payload.userId, title: payload.title, message: payload.message, link: payload.link ?? null,
});
```

Qualquer colaborador conectado recebe, em tempo real, o conteúdo das notificações dos colegas ("Você completou X e ganhou +N pontos", resultados de batalha citando o oponente, links de resgate). O filtro por `userId` fica no cliente — o dado já saiu do servidor.
**Fix:** canal por usuário (`sse:${tenantId}:${userId}`) ou filtrar no servidor antes do `enqueue`. Bônus: o `broadcastToTenant` está exportado de um `route.ts` (import de rota por outro módulo) — mover para `infra/`.

### P1-13 · Autorização por claims de JWT de 7 dias, sem revalidação de papel
`src/auth.config.ts:79-85` (`maxAge: 7d`) · `src/app/api/superadmin/tenants/[id]/credits/route.ts:11-18` · `src/app/superadmin/page.tsx:11-17`
As rotas de superadmin leem `role` **do token**, não do banco. Rebaixar/remover um usuário não tem efeito até o token expirar (até 7 dias); e `revoke-all` só funciona com Redis (`auth.ts:41-50`, no-op sem Upstash — ver P1-9). `getSessionContext` revalida usuário+tenant (bom), mas só é usado nas rotas de tenant.
**Fix:** nas rotas privilegiadas, revalidar `role`/`status` no banco a cada request (custo de 1 query) ou reduzir `maxAge` para horas com refresh; e considerar `status` de conta em `User` para revogação real.

### P1-14 · Service Worker guarda HTML autenticado no dispositivo
`public/sw.js:85-103,105-113` — `navigationFirst` grava **toda** navegação bem-sucedida em `PAGE_CACHE` e, offline, serve `/dashboard` em cache como fallback; a única exclusão é `/api/`, `/_next/static/`, `/icons/` e `manifest.json`.

Consequência: em um computador/tablet compartilhado (cenário real de treinamento corporativo), depois do logout outro usuário consegue abrir `/dashboard`, `/admin/*` ou `/profile` do anterior a partir do cache — dados pessoais e de outro tenant. Além disso `VERSION = 'pontufy-v1'` é fixo, então o cache nunca é invalidado por release.
**Fix:** cachear apenas assets estáticos e uma página `/offline` própria; nunca HTML de rota autenticada; `VERSION` derivado do build; `caches.delete()` no logout.

---

## 5. P2 — Qualidade, manutenibilidade e produto

### 5.1 Modelagem de dados
- **Zero `enum` Prisma.** Todo estado é `String` livre: `role`, `plan`, `contractStatus`, `status`, `type` (`schema.prisma:26-27,33,63,94,147,162,214,246,267,329,353,464`). Efeito real: `Redemption.status` é `PENDING/CONFIRMED` mas `Commission.status` é `pending/approved`, e `persistCommission` compara `'approved'` (`rewards:232`) enquanto `mapLomadeeStatus` devolve `'CONFIRMED'` (`:205-210`). Criar enums resolve a classe inteira de bug.
- **JSON em `String @db.Text`.** `quizJson` (`:93`) e `questionsJson` (`:465`) com `JSON.parse` + `try/catch` → `DomainError 500`. O repo já usa `Json` corretamente em `AuditLog`/`Notification`/`postbackPayload`.
- **Sem soft delete.** Nenhum `deletedAt`; `User`/`Course`/`Reward` são `DELETE` físico. `AuditLog` diz "append-only imutável" mas tem `onDelete: Cascade` no tenant (`:255`) — apagar o tenant apaga a trilha.
- **Integridade referencial incompleta.** `Redemption.rewardId` não tem FK (`:206-227`) e o código grava o literal `'lomadee-product'` (`rewards:169`); `IssuedCertificate` não tem relação com `Course`/`Tenant` (`:299-314`).
- **Contadores de notificação não atômicos** — `redis.ts:65-96` faz `get`+`set`; usar `incrby`/Lua.

### 5.2 Erros e contratos
- `jsonError` (`domain/auth/index.ts:35-48`) não mapeia erros Prisma: `P2025` vira 500 em vez de 404 (`toggleReward`), `P2002` vira 500 em vez de 409. Criar um `mapPrismaError` único.
- `users/me/history:25-27` faz `catch { return 401 }` para **qualquer** erro — falha de banco se disfarça de "não autenticado".
- `/api/setup/seed` devolve `details: String(error)` (SQL/schema) ao cliente e usa `AUTH_SECRET` como bearer estático.
- `tx as never` em 5 pontos (`learning:52,183`, `rewards:85,152,254`): o tipo `Tx` é um stub manual, então erro de schema não é pego em compilação. Usar `Prisma.TransactionClient`.

### 5.3 Frontend / UX
- **A tela de resgate mostra um cupom falso.** `src/components/marketplace/CheckoutDrawer.tsx:63-66` gera `PONTUFY-XXXX-NNNN` com `Math.random()` no navegador e o apresenta como "Seu Código de Resgate". É a tela final da jornada principal do produto — e ela inventa um dado. Além disso `:57` faz fallback para `reward?.id || "mock-reward-id"`, `:78` usa `alert()` e `:45-52` chama `setState` durante o render.
- **Duplicação de componentes de resgate:** `components/marketplace/CheckoutDrawer.tsx` (281 linhas, fake) × `components/rewards/CheckoutDrawer.tsx` (usa o store), `ProductCard` × `RewardCard`, `ProductGrid`. A página `/loja` usa a versão fake.
- **17 das 34 páginas são `'use client'`** (incluindo `/dashboard`, `/cursos`, `/player/[id]`, `/wallet`, `/profile`) e buscam dados via `fetch('/api/...')` em hooks client-side, perdendo SSR/RSC e criando waterfall na hidratação. São candidatas naturais a Server Components + Server Actions.
- **Duas camadas de estado para o mesmo dado:** zustand (`currentPointsBalance`) + SWR + `useState` local; `mutate` manual espalhado (`useApi.ts:80-82,102-104`).
- **Sem `loading.tsx`/`error.tsx` em 27 das 34 rotas**; os 6 `error.tsx` que existem são **cópias idênticas de 11 linhas** (consolidar em um só, usando o `ErrorState` que já existe) e apenas 3 rotas têm `loading.tsx`.
- **HTML não escapado no e-mail de certificado** (`certificate-service.ts:149-162` interpola `employeeName`/`courseName`/`tenantName`) — e-mail injection com remetente legítimo.
- Acessibilidade: botões de ícone sem `aria-label` (ex.: `CheckoutDrawer.tsx:116`), `div` clicável como backdrop, foco não gerenciado em drawers.

### 5.4 Código morto e ruído (remover)
Re-exports de 1 linha que só duplicam caminho: `src/lib/{battles,crypto,dept-ranking,email,gamification,lomadee,redis,skill-tree,stripe}.ts`, `src/lib/redis/mutex.ts`, `src/backend/{db,logger,session}.ts`, `src/domain/tenant/index.ts`, `src/domain/certificates/index.ts`.
**Código 100% morto confirmado por grep:** `src/lib/security/signed-urls.ts` (nunca importado, com `SIGNING_SECRET` fallback hardcoded) e `src/app/api/cron/rewards-sync/route.ts` (mock: `simulateAffiliateCheck` sempre `false`, dorme 50 ms por reward, agendado diariamente).
Também: `x-tenant-id`/`x-user-role` injetados no `proxy.ts:64-68` e **lidos por ninguém**; `src/lib/cache/rewards.ts` duplica o cliente Redis em vez de usar `getRedis()` e devolve string JSON ou array dependendo do cache (bug de tipo).

### 5.5 Observabilidade
98 `console.*` no código (78 fora de `infra`/`lib`), sem request-id, sem Sentry/OTel, sem métricas. `logger.ts` tem 46 linhas — bom ponto de partida, mas não é usado de forma consistente e não tem correlação. Falhas silenciosas são o padrão: `.catch(() => {})` em e-mail, `notify*` sem `await`, `logAudit` engolindo erro.

### 5.6 Testes e CI
- 8 specs (**44 testes**) E2E + integração de API, **zero teste unitário** — as regras de dinheiro (`debitPoints`, `creditPoints`, `redeemReward`, `completeLesson`) não têm teste rápido; só dá para exercitá-las subindo Postgres + Redis reais. Lacunas concretas de cobertura: **login/lockout** (só smoke), **resgate feliz e saldo insuficiente** (só 404 cross-tenant), **Stripe com evento válido** (só assinatura forjada), **postback de sucesso** (só 401).
- `playwright.config.ts` sobe `next dev` (não o build de produção), `workers: 1`, tudo contra **um** banco compartilhado — sem banco efêmero por execução.
- `tests/global-setup.ts:160-175` **apaga dados** (`pointsLedger.deleteMany`, `lessonCompletion.deleteMany`...) dos usuários de teste. Se alguém rodar a suíte apontando para produção (o que o `.env.local` naturalmente faria se tivesse `DATABASE_URL`), destrói o ledger real. Falta um guard `if (NODE_ENV === 'production' || URL.includes('supabase.co')) throw`.
- **Não existe CI** (sem `.github/`). E o Next 16 **não roda mais lint no build** (`next lint` foi removido), então `next build` não é gate de lint em lugar nenhum: `npx eslint .` retorna **146 problemas (109 erros / 37 warnings)** sem nenhuma consequência automática.
- `npx tsc --noEmit` falha com **98 erros** (84 × `TS7016`): a árvore de `node_modules` deste checkout está incompleta — `next-auth` tem 0 `.d.ts` e 71 `.d.ts.map`, `lucide-react` não tem `dist/lucide-react.d.ts`, `ai` não tem `dist/index.d.ts`. Como `next.config.ts` **não** define `typescript.ignoreBuildErrors`, um build limpo a partir daqui **falha no typecheck**. Primeiro passo é `rm -rf node_modules && npm ci` e revalidar (provável corrupção de instalação/quarentena de antivírus).

### 5.7 Documentação e DX
- `apps/pontufy/README.md` ainda é o boilerplate do `create-next-app`.
- `deploy-guide.md` está **errado**: manda configurar `NEXTAUTH_URL`/`NEXTAUTH_SECRET` (v5 usa `AUTH_SECRET`) e referencia uma rota inexistente (`src/app/api/course/generate/route.ts`).
- `PRODUCTION.md` e `DIAGNOSTICO.md` são bons, mas se contradizem com o `.env.example` (Redis "opcional").
- `CLAUDE.md` é o melhor documento do repo — deveria ser a base do `README` técnico.
- Monorepo sem `packages/` compartilhado: `apps/landing` reimplementa tokens/ícones; sem Turborepo/cache; `dev` de um app não sobe as dependências (Postgres).

### 5.8 Superfície HTTP, sessão e privacidade
- **Nenhum header de segurança.** `next.config.ts` (14 linhas) não define `headers()`, não há CSP, `X-Content-Type-Options`, `Referrer-Policy`, `HSTS` nem `Permissions-Policy`. Com `trustHost: true` (`auth.config.ts:25`) e um app que serve conteúdo gerado por IA, falta a camada de defesa em profundidade.
- **Rate limit por `x-forwarded-for[0]`, spoofável** (`auth-guard.ts:19-23`, `audit.ts:45-49`) — um atacante escolhe o próprio bucket e contorna lockout/limites se não houver um proxy que normalize o header.
- **Reset de senha:** token em query string (`forgot-password/route.ts:45-56`, vaza em Referer/logs de CDN), `PUT` sem rate limit (`:63-85`) e **sem revogar sessões** após troca de senha. Em `users/profile:44`, a troca de senha aceita **6 caracteres** enquanto o cadastro exige 8 (`validations/index.ts:17`) e ainda reimplementa scrypt localmente em vez de usar `infra/crypto`.
- **CSV formula injection** em `api/admin/reports/export/route.ts:66-68` (`course.title` sem `sanitizeCsvField`, que existe e é usado em `payroll/export`).
- **`/api/setup/seed` re-executável em produção** — além do P0-1, o próprio endpoint permite resetar as senhas seed a qualquer momento com `AUTH_SECRET` como bearer (`route.ts:6-11,55-57`).
- **`/api/files/extract`** aceita `formData.getAll('files')` sem limite de quantidade (`:20-21`), valida só a extensão (não o MIME real) e roda `pdf-parse`/`mammoth` em memória — vetor de DoS barato para qualquer usuário autenticado.
- **Painel de segurança do superadmin sempre vazio** — `src/app/superadmin/page.tsx:105` lê `redis.keys('blocked-ip:*')`, mas `blockIp` grava no hash `security:blocked-ips` (`auth-guard.ts:108`) — o padrão nunca casa e o painel reporta 0 bloqueios sempre.
- **`GET /api/admin/branding` expõe `aiCredits`** para **qualquer** usuário autenticado (`route.ts:13,38`; o comentário em `:16` justifica o GET aberto pelo tema) — dado de contrato/billing vazando para colaborador. Separar DTO de branding de DTO de billing.

### 5.9 SEO e performance da landing (`apps/landing`)
- **Sem `robots.txt` e sem `sitemap.xml`** (nem no `public/`, nem gerados no build) — e o app principal também não tem `robots.ts`/`sitemap.ts`. Para um produto B2B que depende de aquisição, é dinheiro deixado na mesa.
- **Sem `canonical` nem `og:url`**; `og:image` em caminho relativo (`/og-image.png`) — alguns scrapers (LinkedIn, WhatsApp) exigem URL absoluta e caem no fallback.
- **Sem JSON-LD** (`Organization`/`SoftwareApplication`/`FAQPage` — a landing já tem `FAQAccordion`, o markup estruturado sairia de graça).
- Declara 3 locales (`og:locale:alternate` `en_US`/`es_LA`, `translations.ts` com 69 KB) mas **sem `hreflang`** e sem rotas de idioma.
- Google Fonts via `<link rel="stylesheet">` render-blocking (3 famílias, 15 pesos) — auto-hospedar ou `preload` + `display=swap`.
- `translations.ts` com 69 KB em um único módulo entra no bundle principal; dividir por idioma com `import()` dinâmico.
- **CTA de login quebrado por default:** `apps/landing/src/config.ts:5` → `APP_URL = import.meta.env.VITE_APP_URL ?? 'https://pontufy.com'`, e `LOGIN_URL = ${APP_URL}/login`. A landing é publicada em `pontufy.com` e o app em `app.pontufy.com` — sem `VITE_APP_URL` setado no build, o botão "Entrar na Plataforma" aponta para `pontufy.com/login`, que não existe (SPA sem rota). Erro de digitação no build = perda de toda a conversão.

### 5.10 Dependências e higiene do repositório
- **Duas camadas de IA em paralelo:** `src/lib/ai-providers.ts` (Vercel AI SDK — usado por `course-generator` e `battles`) e `src/lib/ai-clients.ts` (SDKs raw `@anthropic-ai/sdk` + `openai` + `@google/genai`), sendo que o segundo é consumido **apenas** por `api/ai/health/route.ts`. São 3 SDKs grandes só para um health check, com ordens de prioridade diferentes em cada arquivo. Unificar no AI SDK.
- **`/api/ai/health` não serve como health check:** exige `admin_rh`/`super_admin` (`:57-65`), faz **3 chamadas reais a LLMs** (`:69-73`, custo e latência em cada probe) e devolve 503 sem chaves. Falta um `/api/health` de liveness/readiness (DB `SELECT 1` + Redis `PING`, sem auth, sem LLM).
- **Dependências declaradas e não usadas:** `@supabase/supabase-js` (0 imports; `@supabase/ssr` já o traz) e `lightningcss` como única devDependency da raiz (é transitiva do Tailwind 4).
- **Versões não determinísticas:** `next`/`react` estão pinadas (bom), mas 25 das 26 dependências de runtime usam `^` — inclusive `next-auth@^5.0.0-beta.31` e `prisma`. Considerar `save-exact=true` no `.npmrc` (que hoje só tem `engine-strict=false`).
- **Config local de agente commitada:** `apps/landing/.claude/settings.local.json` está versionado com permissões amplas (`Bash(npm install *)`, `Bash(npm run *)`, MCP `deploy_to_vercel`) e caminhos de máquina (`/Users/flaviosantos/...`). Remover do repo.
- **`skills-lock.json` não confere:** os `computedHash` das duas skills não batem com o SHA-256 dos `SKILL.md` presentes em `.agents/` (foram editados ou o lock é de outra revisão). Como são apenas Markdown lidos por agentes, o risco é instrução desatualizada/injeção de prompt, não execução — mas o lock hoje não garante nada.
- **Ruído:** SVGs do boilerplate (`next.svg`, `vercel.svg`, `globe.svg`, `window.svg`, `file.svg`) sem uso em `public/`; `apps/landing/metadata.json` (artefato de AI Studio).

---

## 6. Plano de execução

### Sprint 0 — "Estancar o sangramento" (2–4 dias) · bloqueia deploy
| # | Ação | Arquivos | Aceite |
|---|---|---|---|
| 1 | Remover auto-seed do build; proibir `update` de `passwordHash` | `scripts/migrate.mjs`, `scripts/check-and-seed.ts` | deploy não altera senha; `superadmin` invalidado em prod |
| 2 | Fail-closed no webhook de afiliados + teto de comissão | `api/webhooks/affiliates`, `domain/rewards` | secret ausente ⇒ 500; HMAC obrigatório |
| 3 | Remover `pointsCost` do contrato; validar URL sempre | `lib/validations`, `domain/rewards` | resgate só por `rewardId` |
| 4 | `updateMany` condicional + `CHECK` de saldo + lock com fencing | `domain/points`, `infra/mutex`, migração | teste concorrente não negativa saldo |
| 5 | Certificado: segredo obrigatório, payload canônico, verificação corrigida | `lib/certificate-*`, `verify/page.tsx` | certificado legítimo ⇒ "Válido" |
| 6 | Crons só por Bearer | 4 rotas de cron | `x-vercel-cron` isolado ⇒ 401 |
| 7 | `next@16.4.4`, `zod@4.6.6`, `next-auth` corrigido | `package.json` | `npm audit --audit-level=high` limpo |

### Sprint 1 — "Confiabilidade" (1 semana)
Corridas de quiz/batalha (P1-5), ordem do Stripe (P1-1), catálogo Lomadee (P1-2), expiração por lote (P1-6), `upsert` no interceptor (P1-7), `lessons/sync` (P1-8), `migrate.mjs` fail-closed (P1-10), rate limit em onboarding (P1-11).
**Entregável transversal:** `src/infra/env.ts` com schema Zod validado no boot (falha rápido), e `mapPrismaError`.
**Testes:** primeiros **unitários de domínio** (Vitest) para `points`, `learning`, `rewards` — os casos de corrida viram teste, não comentário.

### Sprint 2 — "Qualidade e produto" (1–2 semanas)
Consolidar design system (eliminar `marketplace/*` duplicado), corrigir a tela de resgate, migrar 4–6 páginas para RSC, consolidar `error/loading`, remover código morto, `escapeHtml` nos e-mails, logging estruturado com request-id, CI com `install → prisma generate → tsc → lint → vitest → build`.

### Sprint 3 — "Escala" (backlog)
Enums Prisma + migração de dados, `Json` em vez de `Text`, `PointsLot`, soft delete, Sentry/OTel, `packages/ui` compartilhado entre landing e app, paginação em ranking/admin, `orderBy`/`take` em todo `findMany`.

---

## 7. Quick wins (cada um < 1 hora)

1. `x-setup-secret` → segredo próprio (`SETUP_SECRET`) e `404` em produção; remover `details: String(error)`.
2. Remover `/api/cron/rewards-sync` do `vercel.json` (é um mock que gasta tempo de execução).
3. `escapeHtml` no template do e-mail de certificado.
4. `logger.*` no lugar dos 78 `console.*` e mascarar `appToken` no log de `lomadee.ts:115`.
5. Guard em `tests/global-setup.ts` para nunca apontar a um banco de produção.
6. Substituir `alert()` por `Toast` (já existe) no `CheckoutDrawer` e remover o cupom falso.
7. `.env.example`: adicionar `AFFILIATE_WEBHOOK_SECRET`, `LOMADEE_POSTBACK_SECRET`, `CERTIFICATE_VERIFICATION_SECRET`, `GOOGLE_GENERATIVE_AI_API_KEY`; mover `UPSTASH_*` para "obrigatório em produção".
8. Reescrever `README.md` do app a partir do `CLAUDE.md`; corrigir `deploy-guide.md` (`AUTH_SECRET`, não `NEXTAUTH_SECRET`; sem o bloco `functions` inexistente).
9. `error.tsx`/`loading.tsx` genéricos consolidados em `src/app/error.tsx` + `loading.tsx` (hoje são 6 cópias de 11 linhas).
10. Corrigir `VITE_APP_URL` na landing (`app.pontufy.com`) e adicionar `robots.txt`/`sitemap.xml`.
11. Remover `@supabase/supabase-js` e `lightningcss` do `package.json`; remover `apps/landing/.claude/settings.local.json` do repo.
12. `sw.js`: parar de cachear resposta de navegação autenticada e bumpar `VERSION`.
13. Burn-down do ESLint: `--fix` (2 automáticos) + desligar `no-explicit-any` só em arquivos legados com comentário de dívida, ou tipar os 14 `as any`.

---

## 8. Métricas de sucesso

| Métrica | Hoje | Meta 30 dias |
|---|---|---|
| CVEs críticos/altos (`npm audit --omit=dev`) | 10 | 0 |
| Erros de ESLint | 109 (146 problemas) | 0 |
| `tsc --noEmit` | 98 erros | limpo |
| Testes automatizados | 44 (0 unitários) | 44 + ≥ 40 unitários |
| Cobertura de rotas de dinheiro | parcial | ≥ 80% |
| `console.*` fora do logger | 78 | 0 |
| Endpoints públicos sem rate limit | 3 | 0 |
| Saldo negativo possível | sim | impedido por `CHECK` |
| Tempo de deploy com migração falhada detectável | ∞ (silencioso) | falha em < 1 min |

---

## Anexo A — Variáveis de ambiente

| Variável | Usada no código | No `.env.example` | Obrigatória? |
|---|---|---|---|
| `AUTH_SECRET` | sim | sim | **sim** (também usada como API key do seed e HMAC de signed-urls — separar) |
| `DATABASE_URL` / `DIRECT_URL` | sim | sim | **sim** |
| `CRON_SECRET` | sim | sim | **sim em produção** (hoje contornável) |
| `UPSTASH_REDIS_REST_URL/TOKEN` | sim | sim ("opcional") | **sim** — sem ela 2 jornadas quebram e controles de segurança viram no-op |
| `AFFILIATE_WEBHOOK_SECRET` | sim | **não** | **sim** (ausente = webhook aberto) |
| `LOMADEE_POSTBACK_SECRET` | sim | **não** | **sim** |
| `CERTIFICATE_VERIFICATION_SECRET` | sim | **não** | **sim** (default público) |
| `LOMADEE_APP_TOKEN` / `LOMADEE_SOURCE_ID` | sim | sim | para a loja |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | sim | sim | para billing |
| `RESEND_API_KEY`, `GEMINI/OPENAI/ANTHROPIC_API_KEY` | sim | sim | funcional (degradam) |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | **não** (legado) | citado no `deploy-guide` | **remover da doc** |

## Anexo B — Como esta análise foi feita

Leitura integral de `src/domain`, `src/infra`, `src/lib`, `src/proxy.ts`, `src/auth*.ts`, `prisma/`, `scripts/` e das 63 rotas de API; amostragem ampla de páginas/componentes; execução de `npx tsc --noEmit`, `npx eslint .`, `npm audit --omit=dev --json`; conferência de cada afirmação contra o código-fonte citado. Itens marcados **(verificar)** exigem confirmação em produção (ex.: estado de `_prisma_migrations`).

