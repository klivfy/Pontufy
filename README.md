# Pontufy — Monorepo

Este repositório reúne, em um único monorepo com npm workspaces, o código e o histórico que antes viviam em três repositórios separados.

## Estrutura

```
apps/
├── pontufy/    Aplicação principal (Next.js 16 + Prisma/PostgreSQL) — app.pontufy.com
└── landing/    Site institucional (Vite + React, estático) — pontufy.com

archive/
└── pontufy-app-legacy/   Experimento "v2" descontinuado (Next.js 15 + Supabase RPC), fora do build/deploy ativo
```

Veja o README de cada app para detalhes específicos: [`apps/pontufy/README.md`](apps/pontufy/README.md), [`apps/landing/README.md`](apps/landing/README.md), [`archive/pontufy-app-legacy/README.md`](archive/pontufy-app-legacy/README.md).

## Desenvolvimento

```bash
npm install          # instala as dependências de todos os workspaces (apps/*)

npm run dev:pontufy    # roda o app principal
npm run dev:landing    # roda a landing page

npm run build:pontufy
npm run build:landing
```

`archive/pontufy-app-legacy` não faz parte dos workspaces (`workspaces: ["apps/*"]` na raiz) e não é instalado nem buildado a partir daqui.

### Rodando local do zero

A aplicação **não sobe sem banco e sem cache** — e falha de propósito (fail-closed): sem Redis o login responde 503 e o boot aborta sem os segredos obrigatórios.

**1. Banco.** Qualquer Postgres serve. Para um portátil, sem instalar nada e sem privilégio de administrador:

```powershell
$root = Join-Path $env:TEMP "pgportable"
Invoke-WebRequest "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip" -OutFile "$root\pg.zip"
Expand-Archive "$root\pg.zip" -DestinationPath $root
& "$root\pgsql\bin\initdb.exe" -D "$root\data" -U postgres --pwfile=<arquivo-com-a-senha> -E UTF8 --locale=C
& "$root\pgsql\bin\pg_ctl.exe" -D "$root\data" -l "$root\pg.log" -o "-p 5544 -c listen_addresses=127.0.0.1" start
& "$root\pgsql\bin\psql.exe" -h 127.0.0.1 -p 5544 -U postgres -c "CREATE DATABASE pontufy;"
```

**2. `.env.local`** em `apps/pontufy/` (nunca vai para o git):

```
DATABASE_URL="postgresql://postgres:senha@127.0.0.1:5544/pontufy"
DIRECT_URL="postgresql://postgres:senha@127.0.0.1:5544/pontufy"
UPSTASH_REDIS_REST_URL="http://127.0.0.1:8079"
UPSTASH_REDIS_REST_TOKEN="local-dev-token"
AUTH_SECRET="<openssl rand -hex 32>"
CRON_SECRET="<idem>"
AFFILIATE_WEBHOOK_SECRET="<idem>"
LOMADEE_POSTBACK_SECRET="<idem>"
CERTIFICATE_VERIFICATION_SECRET="<idem>"
```

**3. Migrações e dados.**

```bash
cd apps/pontufy
npm run db:deploy      # aplica as migrações
npm run db:seed        # dados de demonstração (senha local: 123456)
```

**4. Subir tudo.**

```bash
cd apps/pontufy
npm run dev:local      # stub do Upstash + next dev, para os dois com Ctrl+C
```

Abre em **http://localhost:3000**. Contas do seed: `admin@empresaalpha.com` (RH), `joao@empresaalpha.com` (colaborador), `superadmin@pontufy.com`.

> **Por que stub e não Redis?** O app usa o cliente **REST** do Upstash, não o protocolo RESP. Um `redis-server` puro não fala REST — o `scripts/local-upstash.mjs` implementa o suficiente (rate limit, lockout, revogação de sessão) para o ambiente de desenvolvimento. Ele **não** é um Redis: não use para medir comportamento de concorrência.


## Deploy

Cada app em `apps/` corresponde a um projeto Vercel próprio, configurado com "Root Directory" apontando para a subpasta correspondente (`apps/pontufy` e `apps/landing`).
