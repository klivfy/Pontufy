# Runbook de deploy

> Atualizado em 04/11/2026. O número de migrações abaixo (6) refere-se ao
> **primeiro** deploy; hoje `prisma/migrations/` tem 25 e o comando continua o
> mesmo — `npm run db:deploy` aplica todas as pendentes.

**Não faça o deploy antes de concluir os blocos abaixo.** Nesta ordem.

---

## Por que a ordem importa (o que acontece se inverter)

| Se você… | Resultado |
|---|---|
| Deploya **sem** os 4 segredos | `assertServerEnv()` lança no boot → **100% das requisições falham** |
| Deploya **sem** as 6 migrações | `prisma.user.findUnique` inclui `sessionVersion` → coluna inexistente → **login quebra** |
| Deploya **sem** Redis em produção | `assertSecurityInfraForLogin()` → **todo login responde 503** |

Os três falham **fechado**, por design (Fases V4/V5). Não há degradação parcial.

---

## Bloco 1 · Aplicar as 6 migrações

```bash
cd apps/pontufy
DATABASE_URL="<pooled>" DIRECT_URL="<direto :5432>" npm run db:deploy
```

Sem CLI? Duas alternativas:

- **GitHub Action:** Actions → **Migrate** → *Run workflow* (exige o secret `DIRECT_URL`).
- **SQL Editor do Supabase:** colar, **nesta ordem**, o conteúdo de:

| # | Arquivo |
|---|---|
| 1 | `prisma/migrations/20261102000000_add_points_balance_nonneg/migration.sql` |
| 2 | `prisma/migrations/20261102010000_add_certificate_signed_payload/migration.sql` |
| 3 | `prisma/migrations/20261102020000_stripe_event_state_machine/migration.sql` |
| 4 | `prisma/migrations/20261103000000_add_provisioning_quota_and_email_verification/migration.sql` |
| 5 | `prisma/migrations/20261103010000_add_user_session_version/migration.sql` |
| 6 | `prisma/migrations/20261103020000_add_job_lock/migration.sql` |

> **Atenção a duas escritas de dados** (intencionais, mas irreversíveis sem backup):
> - `migração 1`: `UPDATE "User" SET "pointsBalance" = 0 WHERE "pointsBalance" < 0`
> - `migração 3`: `UPDATE "StripeEvent" SET "status" = 'processed'`
>
> Faça `pg_dump` antes. Se houver saldo negativo, exporte os IDs afetados.

**Verificação:**
```bash
DATABASE_URL="<pooled>" npx prisma migrate status --schema apps/pontufy/prisma/schema.prisma
# esperado: "Database schema is up to date!"
```

---

## Bloco 2 · Configurar segredos (Production **e** Preview)

| Variável | Valor |
|---|---|
| `CRON_SECRET` | `openssl rand -hex 32` |
| `AFFILIATE_WEBHOOK_SECRET` | `openssl rand -hex 32` |
| `LOMADEE_POSTBACK_SECRET` | `openssl rand -hex 32` |
| `CERTIFICATE_VERIFICATION_SECRET` | `openssl rand -hex 32` (mín. 32 chars) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | confirmar que existem — **sem isso, login = 503** |
| `RESEND_API_KEY` | chave do provedor de e-mail — **sem ela nenhum e-mail sai** |
| `EMAIL_FROM` | remetente verificado no Resend (ex.: `Pontufy <noreply@pontufy.com>`) |

Detalhe de cada um e efeito da rotação: [`SEGREDOS.md`](SEGREDOS.md).

> Se `AFFILIATE_WEBHOOK_SECRET` não for configurado, o webhook de afiliados responde **503** (não aceita anônimo) — correto, mas a integração para de funcionar silenciosamente do lado do parceiro.

### E-mail: o que acontece sem `RESEND_API_KEY`

Nada é entregue. Até 04/11 o envio sem chave imprimia no console e devolvia
sucesso — o outbox marcava como entregue e o problema ficava invisível. Hoje o
transporte é explícito (`src/infra/email.ts`):

| Situação | Transporte | Efeito |
|---|---|---|
| `RESEND_API_KEY` presente | `resend` | envia de verdade |
| `EMAIL_TRANSPORT=log` | `log` | imprime no console (dev/teste) |
| produção, sem chave | `none` | **falha visível**; o worker não consome os eventos |

Com `none`, `/api/health` responde `"email": "not_configured"` e o worker do
outbox devolve `provider_not_configured` — os eventos ficam `pending` e fluem
sozinhos no primeiro tick depois que a chave entra. Nada é perdido.

**Consequência do `none`:** empresa nova nasce em `pending_verification` e não
consegue entrar; recuperação de senha não funciona. Trate como incidente.

### Fila de e-mail (outbox) — o cron que precisa existir

Todo e-mail transacional é gravado em `OutboxEvent` e despachado por
`/api/cron/outbox-worker`, agendado a cada 5 min em `apps/pontufy/vercel.json`.

Esse cron **já ficou fora da agenda** e o resultado foi: nenhum e-mail saía,
empresa nova não ativava, e ninguém percebia. Hoje o gate
`npm run check:crons` falha se uma rota de cron não exportar `GET` ou não
estiver na agenda.

```bash
# o worker está vivo? (Bearer obrigatório)
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  -o /dev/null -w "%{http_code}\n" https://app.pontufy.com/api/cron/outbox-worker
# 200 = rodou · 401 = segredo errado · 503 = CRON_SECRET ausente
```

Para ver o tamanho da fila, olhe o campo `stats` da resposta do worker.

### Empresa presa em `pending_verification` — ativação manual

Se o e-mail não chegar, o suporte libera a empresa sem esperar o link:

```bash
curl -X POST https://app.pontufy.com/api/superadmin/tenants/<id>/activate \
  -H "Cookie: <sessão de superadmin>" -H "Content-Type: application/json" \
  -d '{"reason":"E-mail de verificação não chegou — cliente reportou em 04/11"}'
```

- Só `super_admin` `@pontufy.com`, com motivo de ≥ 10 caracteres.
- Só ativa quem está em `pending_verification`; `suspended`/`cancelled` são
  recusados (são estados comerciais, não e-mail perdido).
- Concede os créditos do trial (respeitando o teto diário), consome os convites
  pendentes e grava `TENANT_ACTIVATED_MANUALLY` na auditoria como ação crítica.

---

## Bloco 3 · Deploy

```bash
git push origin sec/fase-1-2:main
```

É fast-forward: 17 commits, zero conflitos. Alternativa: abrir PR e mergear pela interface.

---

## Bloco 4 · Verificação pós-deploy (6 checks)

```bash
# 1. saúde — deve ser 200 com db=up e email=resend
curl -s https://app.pontufy.com/api/health | jq
#   → { "status": "ok", "db": "up", "redis": "up", "auth": "available", "email": "resend" }

# 2. cron sem credencial — deve ser 401
curl -o /dev/null -w "%{http_code}\n" https://app.pontufy.com/api/cron/expire-points

# 3. cron com header forjável — deve ser 401 (bypass removido)
curl -o /dev/null -w "%{http_code}\n" -H "x-vercel-cron: 1" https://app.pontufy.com/api/cron/expire-points

# 4. webhook sem assinatura — deve ser 400/401/503, nunca 200
curl -o /dev/null -w "%{http_code}\n" -X POST https://app.pontufy.com/api/webhooks/affiliates -d '{}'

# 5. worker do outbox com o segredo — deve ser 200 e trazer `stats`
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://app.pontufy.com/api/cron/outbox-worker | jq '{claimed, processed, stats}'

# 6. fluxo real: criar empresa → e-mail chega → link ativa → login
```

Se o check 1 trouxer `redis: "not_configured"` ou `"down"`, **o login está desligado** — configure o Upstash antes de anunciar o deploy.

Se trouxer `"email": "not_configured"`, **nenhuma empresa nova consegue entrar** e a recuperação de senha não funciona. Configure `RESEND_API_KEY` e faça um deploy novo.

Se o check 5 retornar `provider_not_configured`, é a mesma causa vista pelo worker: os eventos estão parados na fila, não perdidos.

---

## Rollback

1. **Vercel:** Deployments → deploy anterior → *Instant Rollback* (segundos).
2. **Git:** `git revert --no-commit <range> && git commit && git push` (não use `reset --hard` em `main`).
3. **Banco:** as 6 migrações são **aditivas** (colunas, tabelas, índices e constraints), exceto as duas escritas de dados citadas. Reverter o código não exige reverter o schema — o código antigo ignora as colunas novas. É por isso que a ordem "migração → deploy" é segura e a inversa não é.
