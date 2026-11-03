@AGENTS.md

# Pontufy — Instruções para Agentes de IA

## O que é este projeto

Pontufy é uma plataforma B2B SaaS de gamificação corporativa. Empresas (tenants) transformam treinamentos internos em pontos, recompensas reais e cursos gerados por IA.

Papéis: `admin_rh` (RH da empresa), `employee` (colaborador), `super_admin` (interno `@pontufy.com`). O papel `guest` é legado — não convide novos guests; trate registros existentes como employee.

## Stack

| Camada | Tecnologia | Nota |
|---|---|---|
| Framework | Next.js **16.4.4** | `middleware.ts` é DEPRECATED — usar `src/proxy.ts` |
| Auth | NextAuth v5 beta | Cliente: `next-auth/react`. Servidor: `@/auth` |
| ORM | Prisma + PostgreSQL | Nunca SQLite em produção |
| AI | Vercel AI SDK **v6** | `maxOutputTokens`, `toTextStreamResponse` |
| Cache | Upstash Redis | Lazy init. OBRIGATÓRIO em produção (rate limit/lockout/revogação). Sem Redis o core funciona; os controles de segurança viram no-op |
| Pagamentos | Stripe | `src/domain/billing` |
| Afiliados | Lomadee | Um postback: `POST /api/postback/lomadee` |

## Arquitetura

Regra de domínio: rotas HTTP autenticam, validam Zod e chamam `src/domain/*`. Não coloque regra de negócio em `app/api`.

```
src/
├── domain/          # regras de negócio
│   ├── auth/
│   ├── learning/    # completeLesson, quiz
│   ├── points/      # credit / debit
│   ├── rewards/     # catálogo, resgate, postback
│   ├── certificates/
│   ├── billing/
│   ├── skills/
│   ├── battles/
│   └── engagement/  # streak, ranking de departamento
├── infra/           # db, redis, email, stripe, lomadee, crypto, logger
├── proxy.ts         # middleware Next.js 16
└── app/             # adapters HTTP e páginas
```

Isolamento multi-tenant: **nunca** `prisma` direto para dado de tenant. Sempre `getTenantDb(tenantId)` de `@/infra/db` (reexportado em `@/backend/db`).

`Reward`: leitura = global (`tenantId` null) + próprio tenant; escrita só no próprio.
`Lesson`: sem `tenantId` — escopo via `course.tenantId`. Usar `findFirst`, nunca `findUnique`, em queries tenant-sensitivas.

## O que NÃO fazer

- Não criar `src/middleware.ts`
- Não usar `maxTokens` / `toDataStreamResponse()` (AI SDK v6)
- Não inicializar Upstash no top-level
- Não hardcodar `tenantId`
- Não reabrir `/api/webhooks/lomadee` unsigned — o postback canônico é `/api/postback/lomadee`
- Não adicionar segunda vitrine: a loja é `/loja`
- Não reconstruir certificados, analytics, onboarding ou notificações — já existem
- **Não semear o banco no build/deploy.** Nenhum script de seed roda no `npm run build`; qualquer seed que reescreva `passwordHash` é backdoor (ver `scripts/check-and-seed.ts`)
- **Não aceitar `x-vercel-cron` como autorização de cron.** Só `Authorization: Bearer $CRON_SECRET` (`src/lib/security/cron-auth.ts`)
- **Não aceitar preço de resgate vindo do cliente.** Só `rewardId`; o valor é `Reward.pricePoints` no servidor
- **Não voltar o débito de pontos para read-then-update.** Usar `debitPoints` (UPDATE condicional) + a constraint `User_pointsBalance_nonneg`
- **Tenant só nasce em `provisionTenant()`** (`src/domain/tenant/provision.ts`). Nenhuma rota ou fluxo cria `Tenant` direto: é lá que ficam os tetos diários, o estado `pending_verification` e a concessão de créditos de IA
- **`pending_verification` bloqueia login** — a regra vive em `isTenantBlocked()` (`src/domain/tenant/status.ts`). Não duplicar checagem de `contractStatus` em outro arquivo

## Rotas públicas no proxy

`/login`, `/register`, `/forgot-password`, `/reset-password`, `/unlock-account`, `/verify`, `/verify-tenant`, `/termos`, `/privacidade`, `/superadmin/login`.

`/admin/*` exige `admin_rh`. `/superadmin/*` exige `super_admin` + email `@pontufy.com` (403 opaco).

## Tema visual

MD3 no produto: `bg-md-surface`, `text-md-on-surface`, accent `md-primary` / emerald. Superadmin usa violeta.

## Seeds

**Nunca em produção, nunca no build.** Dois caminhos, ambos manuais e locais:

- `SEED_ADMIN_PASSWORD='<senha-forte>' npx tsx scripts/check-and-seed.ts` — cria tenant/contas de desenvolvimento. Recusa rodar com `NODE_ENV=production` ou `VERCEL_ENV` presente e **nunca** sobrescreve senha existente.
- `npx prisma db seed` (`prisma/seed.ts`) — dados de demonstração (cursos, recompensas). Senha local documentada: `123456`.
- `/api/setup/seed` responde **404** fora de desenvolvimento e exige `SETUP_SECRET` + `SETUP_ADMIN_PASSWORD`.

Contas de dev: `admin@empresaalpha.com` (`admin_rh`), `joao@empresaalpha.com` (`employee`), `superadmin@pontufy.com` (`super_admin`, senha definida por `SEED_ADMIN_PASSWORD`).
