@AGENTS.md

# Pontufy — Instruções para Agentes de IA

## O que é este projeto

Pontufy é uma plataforma B2B SaaS de gamificação corporativa. Empresas (tenants) transformam treinamentos internos em pontos, recompensas reais e cursos gerados por IA.

Papéis: `admin_rh` (RH da empresa), `employee` (colaborador), `super_admin` (interno `@pontufy.com`). O papel `guest` é legado — não convide novos guests; trate registros existentes como employee.

## Stack

| Camada | Tecnologia | Nota |
|---|---|---|
| Framework | Next.js **16.2.9** | `middleware.ts` é DEPRECATED — usar `src/proxy.ts` |
| Auth | NextAuth v5 beta | Cliente: `next-auth/react`. Servidor: `@/auth` |
| ORM | Prisma + PostgreSQL | Nunca SQLite em produção |
| AI | Vercel AI SDK **v6** | `maxOutputTokens`, `toTextStreamResponse` |
| Cache | Upstash Redis | Lazy init. Sem Redis: lockout/SSE/rate-limit viram no-op |
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

## Rotas públicas no proxy

`/login`, `/register`, `/forgot-password`, `/reset-password`, `/unlock-account`, `/verify`, `/termos`, `/privacidade`, `/superadmin/login`.

`/admin/*` exige `admin_rh`. `/superadmin/*` exige `super_admin` + email `@pontufy.com` (403 opaco).

## Tema visual

MD3 no produto: `bg-md-surface`, `text-md-on-surface`, accent `md-primary` / emerald. Superadmin usa violeta.

## Seeds

Senha local: `123456`. `admin@empresaalpha.com` (`admin_rh`), `joao@empresaalpha.com` (`employee`). `npx prisma db seed`.
