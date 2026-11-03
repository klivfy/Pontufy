# Execução — Fase 2 (parcial)

**Data:** 02/11/2026 · **Base:** [PLANO-DE-ACAO.md](PLANO-DE-ACAO.md) · **Continuação de:** [EXECUCAO-FASE-1.md](EXECUCAO-FASE-1.md)
**Status:** **10 de 11 itens concluídos**. F2.5 (expiração por lote) foi deliberadamente adiada para a Onda A da [ESTRATEGIA-ESTRUTURAL.md](ESTRATEGIA-ESTRUTURAL.md) — corrigir sem `PointsLot` seria remendo.

---

## 1. Gates ao final desta fase

| Gate | Antes (fim da Fase 1) | Agora |
|---|---|---|
| `tsc --noEmit` | 0 erros | 0 erros |
| ESLint | 140 problemas | **139** (baseline atualizado) |
| `npm audit --omit=dev` | 0 | 0 |
| `next build` | exit 0 | exit 0 |

---

## 2. O que foi entregue

### F2.1 · Stripe: idempotência com máquina de estados ✅
`prisma/schema.prisma` + migração `20261102020000_stripe_event_state_machine` + `webhooks/stripe/route.ts`.

- `StripeEvent` ganhou `status` (`processing` | `processed` | `failed`), `attempts` e `updatedAt`.
- O claim acontece **antes** do trabalho, mas só vira `processed` **no fim**; falha marca `failed` e devolve 500 — o retry do Stripe passa a poder concluir o evento.
- Claim em `processing` expira em 60 s (instância que morreu no meio não bloqueia para sempre).
- Reentrega após `processed` responde `duplicate` sem incrementar tentativas.
- Linhas pré-existentes foram marcadas `processed` na migração (não reprocessar efeitos financeiros antigos).
- Teste: `tests/api/stripe-idempotency.spec.ts` (2 casos, com assinatura real gerada por `generateTestHeaderString`).

### F2.2 · Sincronização Lomadee não apaga mais o catálogo ✅
`cron/sync-lomadee/route.ts`.

- Catálogo vazio **ou** com falha parcial (`diagnostics.errors`) ⇒ **aborta com 502 e não desativa nada**.
- A desativação deixou de ser `externalId: { notIn: [...] }` (que matava tudo fora da página 1 de 50) e passou a ser por `updatedAt < corte de 7 dias`.
- Resultado: a loja não se esvazia sozinha de madrugada.

### F2.3 · Corridas que duplicavam crédito ✅
- **Quiz** (`domain/learning`): transação em `SERIALIZABLE` + retry em `P2034`. Duas aprovações simultâneas deixam de creditar +50 duas vezes.
- **Batalha** (`domain/battles/engine`): reserva do turno por compare-and-set (`updateMany` com `challengerElapsed: null`/`opponentElapsed: null`) e transição para `completed` condicional a `status != 'completed'` — crédito de departamento acontece uma única vez, **sem depender do Redis**.

### F2.4 · `lessons/sync` creditava a aula errada ✅
`api/lessons/sync/route.ts`: `createManyAndReturn` (RETURNING do Postgres) no lugar de `slice(0, created.count)`. Com `[duplicada, nova]`, o código antigo creditava a duplicada e nunca a nova.

### F2.6 · Validação de ambiente no boot ✅
Novos `src/infra/env.ts` + `src/instrumentation.ts`.

- Zod agregando: banco (6 aliases), `AUTH_SECRET`, `CRON_SECRET`, `AFFILIATE_WEBHOOK_SECRET`, `LOMADEE_POSTBACK_SECRET`, `CERTIFICATE_VERIFICATION_SECRET`, Stripe e Upstash.
- **Produção:** qualquer problema **aborta o boot** com a lista completa.
- **Desenvolvimento:** apenas avisa — não trava o `next dev` de quem não configurou tudo.
- `register()` ignora Edge e build; import dinâmico para não vazar Prisma para o bundle do proxy.

### F2.7 · Migração fora do build e fail-closed ✅
- `npm run build` = `prisma generate && next build` — **não migra mais**.
- `scripts/migrate.mjs` aborta com `exit 1` e mensagem acionável (antes engolia a falha e o deploy ficava verde com schema velho).
- Novo `npm run db:deploy` + workflow `.github/workflows/migrate.yml` (manual e em push que toque `prisma/**`), com guard de secret ausente e `migrate status` antes/depois.

### F2.8 · Buracos do interceptor multi-tenant ✅
`infra/db.ts`:
- `upsert` passou a ser tratado (antes não estava em nenhuma lista e passava **sem** `tenantId` no `where` nem no `create`).
- `Reward` lê com `AND: [where, { OR: [global, próprio] }]` — o `OR` do chamador não é mais sobrescrito.
- `Reward.create/createMany` força o próprio tenant (recompensa global só via `getRawPrisma`).
- Bônus: 2 `eslint-disable` mortos removidos, `any` eliminado no mapper de batalhas.

### F2.9 · SSE por usuário ✅
Novo `infra/sse.ts` com canal `sse:{tenantId}:{userId}`. Antes o canal era por tenant e todo colaborador conectado recebia `message`/`link` das notificações dos colegas — o filtro era no cliente, ou seja, o dado já havia saído do servidor. O publisher saiu de `route.ts` (importar rota é anti-padrão) para `infra/`.

### F2.10 · Service Worker sem HTML autenticado ✅
`public/sw.js`: navegação virou network-only com página offline neutra; `PAGE_CACHE` de documentos deixou de existir; `VERSION` foi para `v2` (limpa caches antigos). Antes, em dispositivo compartilhado, o `/dashboard` de um usuário podia ser servido a outro após logout.

### F2.11 · Rate limit e Zod no onboarding público ✅
`api/tenants/onboarding`: 5 criações/hora por IP + `tenantOnboardingSchema` (antes: validação manual e nenhum limite — provisionamento de tenants em loop).

---

## 3. Adiado com justificativa

| Item | Por quê | Onde entra |
|---|---|---|
| **F2.5 · expiração de pontos** | A heurística "soma de ganhos antigos − soma de expirações" não é corrigível sem saber **qual** ganho expirou. Remendá-la criaria uma segunda fonte de verdade sobre o mesmo saldo. | Onda A (A1 — `PointsLot`), ESTRATEGIA-ESTRUTURAL.md |

---

## 4. Novos arquivos

`src/infra/env.ts`, `src/instrumentation.ts`, `src/infra/sse.ts`, `.github/workflows/migrate.yml`, `prisma/migrations/20261102020000_stripe_event_state_machine/`, `tests/api/stripe-idempotency.spec.ts`.

## 5. Pendências operacionais herdadas (continuam valendo)

As 7 da seção 6 do [relatório da Fase 1](EXECUCAO-FASE-1.md#6-pendências-não-são-código--exigem-produçãodecisão) — em especial **rotacionar segredos**, **rodar a forense do backdoor** e **aplicar as 3 migrações** (`20261102000000`, `20261102010000`, `20261102020000`).

> Com F2.7, a aplicação das migrações deixou de acontecer no deploy. O caminho agora é `npm run db:deploy` com `DIRECT_URL` ou o workflow **Migrate** no GitHub Actions (exige o secret `DIRECT_URL`).
