# Diagnóstico — estado após reconstrução in-place

Documento histórico da auditoria original (SQLite em serverless, isolamento de Reward/Lesson, webhooks). O núcleo disso já foi corrigido.

Estado atual relevante:

- Persistência: PostgreSQL (Supabase). SQLite não é opção de produção.
- Cron Lomadee exige Bearer `CRON_SECRET` ou header `x-vercel-cron: 1`.
- Postback canônico: `POST /api/postback/lomadee?token=LOMADEE_POSTBACK_SECRET`.
- `/verify` é rota pública no `proxy.ts`.
- Redis ausente: lockout, SSE e rate-limit degradam (fail-open). Configure Upstash em todos os envs da Vercel.
- `AUTH_SECRET` e `DATABASE_URL`/`DIRECT_URL` continuam obrigatórios em produção.

Arquitetura viva: `src/domain/*` (regras) + `src/infra/*` (adapters). Ver `CLAUDE.md`.

Playwright: `DATABASE_URL` (Postgres) é obrigatório. Sem Redis, locks de aula/resgate falham fechado (429). Neste Windows, o webServer da suíte usa `next dev --webpack` porque o binding nativo do Turbopack pode não carregar.
