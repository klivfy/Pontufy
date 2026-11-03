# Plano de correção estrutural — início

**Base:** [SEGURANCA-ESTRUTURAL.md](SEGURANCA-ESTRUTURAL.md) (11 vulnerabilidades estruturais)
**Contexto:** Fases 0–2 concluídas; V1 e parte da V9 já mitigadas durante o estudo.
**Premissa:** 1 dev full-stack. Com 2 pessoas, E2 e E3 paralelizam (E1 não — tem dependência de decisão).
**Esforço restante:** ~16 dev-days de código + 5 decisões de negócio.

---

## 0. O que já está fechado (não repetir)

| Item | Estado | Evidência |
|---|---|---|
| **V1** — autorização descentralizada | ✅ **fechado** | `route-guards.json` + `check-route-guards.mjs` no CI: 63 rotas declaradas, rota nova sem política quebra o build |
| **V9** — CSV injection em relatórios | ✅ fechado | `reports/export` usa `buildCsvRow` |
| **V9** — `aiCredits` exposto a colaborador | ✅ fechado | `GET /api/admin/branding` só devolve para admin |
| **V9** — `appToken` da Lomadee em log | ✅ fechado | `requestJson` mascara token/UUID |

**Restam 9 classes:** V3, V4, V2, V5, V7, V6, V8, V9 (e-mail de certificado), V10, V11.

---

## 1. Ordem de ataque (e a razão)

| Ordem | Vulnerabilidade | Por que nesta posição | Esforço |
|---|---|---|---|
| **1º** | **V3** — provisionamento sem controle | custo financeiro direto (créditos de IA) e explorável hoje por qualquer pessoa | 2 d |
| **2º** | **V4** — controles fail-open | desliga 5 proteções em silêncio; é a diferença entre "seguro" e "seguro até o Redis cair" | 1,5 d |
| **3º** | **V2** — interceptor é convenção | vazamento entre tenants é o pior dano possível num B2B; a barreira é barata | 2 d |
| **4º** | **V5** — sessão com papel do token | mudança de papel não tem efeito por até 7 dias; sem MFA no superadmin | 3 d |
| **5º** | **V7** — consultas sem limite / jobs sem lock | degradação progressiva e custo; vira incidente quando a base cresce | 2 d |
| **6º** | **V6** — arquivo não confiável | DoS por colaborador autenticado; precisa de política de recurso | 1,5 d |
| **7º** | **V8** — segredos e cadeia de suprimentos | não é explorável por HTTP; é risco operacional e de reputação | 2 d |
| **8º** | **V9** (resto) + **V10** | defesa em profundidade; baixo risco individual | 1,5 d |
| **9º** | **V11** — staging e deploy | habilitador: sem isso, cada correção é validada em produção | 2 d |

**Critério de parada por item:** o item só fecha com **teste automatizado** que falha antes e passa depois (ver seção 6).

---

## 2. Portão 0 — pré-requisito de tudo (antes do E1)

As correções já feitas (Fases 1–2 + V1 + V9 parcial) **não estão em produção**: `origin/main` segue em `9584663`. Corrigir sobre código que não roda é teatro.

| # | Ação | Depende de |
|---|---|---|
| P0.1 | Configurar os 4 segredos na Vercel (`CRON_SECRET`, `AFFILIATE_WEBHOOK_SECRET`, `LOMADEE_POSTBACK_SECRET`, `CERTIFICATE_VERIFICATION_SECRET`) | você |
| P0.2 | Aplicar as 3 migrações (`npm run db:deploy` com `DIRECT_URL`) | você |
| P0.3 | Rodar a forense do backdoor e desativar `superadmin@pontufy.com` | você |
| P0.4 | Revisar e mergear `sec/fase-1-2` | você |
| P0.5 | Backup do banco com restore validado | você |

> Sem P0.1–P0.2, o deploy da branch **derruba a produção** (env fail-fast + colunas novas referenciadas pelo código).

---

## 3. Sprint E1 — "Fechar o que dá dinheiro e o que desliga sozinho" (semana 1 · 5 d)

### E1.1 · V3 — Provisionamento unificado (2 d)

**Problema.** Três caminhos criam `Tenant`; só `/api/tenants/onboarding` tem limite. `createPersonalTenant` cria empresa + trial + 20 créditos de IA para qualquer e-mail Google desconhecido.

**O que fazer.**
1. Criar `src/domain/tenant/provision.ts` com **a única** função que cria tenant:
   ```ts
   export async function provisionTenant(input: {
     companyName: string; sector: Sector; adminName: string; adminEmail: string;
     origin: 'onboarding' | 'google' | 'import'; verifiedEmail: boolean;
   }): Promise<ProvisionResult>
   ```
   Regras dentro dela: limite por e-mail/domínio (24 h), teto global diário de tenants (ex.: 20/dia), teto global diário de créditos de IA concedidos, `aiCredits` inicial = **0** até o e-mail ser verificado.
2. `POST /api/tenants/onboarding` passa a chamar `provisionTenant` (remove a lógica própria).
3. `upsertGoogleUser`: `intent === 'tenant'` → exige e-mail verificado (o Google já entrega `email_verified`); e-mail desconhecido **sem** intenção explícita → **não cria tenant**; devolve `{ ok: false, code: 'signup_required' }` e redireciona para `/register/tenant`.
4. Remover `createPersonalTenant` (ou colocá-la atrás de `ALLOW_PERSONAL_TENANTS=1`, default off).
5. Migração de dados: não necessária.

**Aceite.**
- `createPersonalTenant` não existe mais (ou está atrás de flag desligada).
- 21º tenant criado no dia ⇒ bloqueado (teto global).
- E-mail Google novo sem intenção ⇒ não cria `Tenant` (asserção no banco).
- Créditos de IA concedidos em 24 h ≤ teto configurado.

**Teste.** `tests/api/provisioning-limits.spec.ts` — 3 casos (teto global, e-mail não verificado, caminho Google).

**Risco de regressão.** O fluxo de auto-cadastro comercial pode depender de provisionar na hora. Mitigação: criar o tenant **pendente** (`contractStatus: 'pending_verification'`) e liberar após verificação — o usuário vê "confirme seu e-mail" em vez de erro.

---

### E1.2 · V4 — Controles de segurança fail-closed (1,5 d)

**Problema.** Sem Redis: `rateLimitCheck` → `allowed: true`, lockout nunca bloqueia, `revoke-all` no-op, quota de IA ilimitada.

**O que fazer.**
1. Novo `src/infra/security-controls.ts`:
   ```ts
   export function securityInfraAvailable(): boolean
   export async function enforceRateLimit(key, max, window): Promise<'allowed' | 'blocked' | 'unavailable'>
   export async function enforceLockout(email): Promise<'clear' | 'locked' | 'unavailable'>
   ```
2. Política por endpoint (decisão registrada em ADR-008):
   - **Autenticação** (`login`, `register`, `forgot-password`, `unlock`, `onboarding`): sem Redis ⇒ **503 + `Retry-After`** e log de erro crítico. *Fail-closed.*
   - **Uso normal** (resgate, aula, quiz): sem Redis ⇒ prossegue (a correção já vive no banco) + log.
3. `/api/health` novo (público, sem auth, sem LLM): `SELECT 1` no banco + `PING` no Redis, 200/503, JSON `{ db, redis, version }`.
4. Alerta: se `redis: down` por 2 verificações consecutivas, log `logger.error` com tag `security-infra` (Sentry na Onda B o captura).

**Aceite.**
- Com `UPSTASH_*` removidas: `POST /api/auth/...` responde 503; `POST /api/lessons/complete` continua 200.
- `/api/health` responde 503 com redis down e 200 com tudo ok.
- Nenhum `if (!redis) return allow` sobra em caminho de autenticação (grep no CI).

**Teste.** `tests/api/security-infra.spec.ts` (2 casos) + health.

**Decisão pendente.** Aceitar que uma queda do Upstash bloqueia login (é o preço do fail-closed) ou manter fail-open com alerta? **Recomendação: fail-closed em auth** — brute force ilimitado é pior que 30 min de indisponibilidade.

---

### E1.3 · V2 — Interceptor vira barreira (2 d)

**Problema.** 36 chamadas diretas a modelos de tenant em 15 arquivos; `$queryRaw` e escrita aninhada passam por fora; nada impede a 37ª.

**O que fazer.**
1. Mover `getRawPrisma()` para `src/infra/platform-db.ts` (nome hostil; importar é ato deliberado) e atualizar os 6 usos.
2. Regra ESLint em `eslint.config.mjs`:
   ```js
   { files: ['src/**/*.ts'], ignores: ['src/infra/platform-db.ts', 'src/domain/**', ...],
     rules: { 'no-restricted-syntax': ['error', {
       selector: "MemberExpression[object.name='prisma'][property.name=/^(user|course|lesson|reward|redemption|invitation|notification|battle|skill|quizAttempt|pointsLedger|lessonCompletion|issuedCertificate|auditLog|commission)$/]",
       message: 'Dado de tenant só via getTenantDb(tenantId). Use platform-db.ts apenas em fluxo de plataforma.' }] } }
   ```
3. Allowlist explícita para os 15 arquivos legítimos (crons, auth pré-sessão, seed, verificação pública) — cada um com comentário justificando.
4. Teste de contrato `tests/api/tenant-isolation.spec.ts` (estender): para cada modelo estrito, criar linha no tenant B e provar que o client do tenant A não a lê (já existe parcialmente — completar para `upsert` e `create` aninhado).

**Aceite.**
- Lint falha ao adicionar `prisma.user.findMany()` num arquivo fora da allowlist.
- Teste de contrato verde para: `user`, `course`, `reward` (global+próprio), `lesson` (via relação), `notification`.
- `getRawPrisma` só importável de `platform-db.ts` (grep no CI).

---

## 4. Sprint E2 — "Privilégio e volume" (semana 2 · 5 d)

### E2.1 · V5 — Sessão com revalidação e MFA (3 d)
1. Coluna `User.sessionVersion Int @default(1)` (migração) — revogação **sem Redis**.
2. `jwt` callback: carrega `sessionVersion` na emissão; revalida em rotas privilegiadas (`requireRole`, superadmin) com 1 query indexada.
3. `revoke-all` incrementa a versão no banco (não só no Redis).
4. **MFA para `super_admin`, passo 1 (sem dependência nova):** exigir que superadmin autentique pelo **Google SSO** (`@pontufy.com`) — `passwordHash` de superadmin passa a ser `null` obrigatoriamente. Passo 2 (TOTP) fica no backlog.
5. `maxAge` de 7 d → **24 h** para `admin_rh`/`super_admin` (refresh contínuo já existe via `updateAge`).

**Aceite.** Rebaixar `admin_rh` → `employee` corta acesso na próxima requisição privilegiada; `revoke-all` funciona sem Redis; login por senha de `super_admin` é recusado.

### E2.2 · V7 — Volume e exclusão mútua (2 d)
1. Advisory lock de Postgres nos 4 crons: `SELECT pg_try_advisory_lock(hashtext($nome))` + release no `finally` (funciona sem Redis).
2. Cursor obrigatório: `expire-points` (lote de 500), `reports/export` (stream por curso), `streak` (últimos 365 dias), `ranking` (janela de 90 dias).
3. Guarda de tamanho em `reports/export`: recusar com 413 se o resultado passar de N linhas.

**Aceite.** Dois disparos simultâneos do mesmo cron ⇒ o segundo retorna `{ skipped: true, reason: 'locked' }`; nenhuma consulta sem `take`/`limit` nos caminhos listados (grep no CI).

---

## 5. Sprint E3 — "Superfície e operação" (semana 3 · 6 d)

| ID | Item | Entrega | Esforço |
|---|---|---|---|
| E3.1 | **V6** upload | MIME por magic bytes, máx. 5 arquivos × 4 MB por request, timeout de 20 s no parse, quota por tenant/dia | 1,5 d |
| E3.2 | **V9 resto** | `escapeHtml` único aplicado ao e-mail de certificado; `select` explícito obrigatório nas respostas (regra de revisão + checklist) | 1 d |
| E3.3 | **V10** headers | `headers()` com CSP por nonce, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` + teste que falha se sumirem | 1 d |
| E3.4 | **V8** operação | Repo privado (ou secret scanning no CI), `.claude/` fora do versionamento, guarda dura no `tests/global-setup.ts` (recusa host ≠ localhost), inventário de segredos com prazo de rotação | 1 d |
| E3.5 | **V11** deploy | Staging (projeto + banco), migração como gate do build (`prisma migrate status` antes do `next build`), rollback documentado e testado | 1,5 d |

---

## 6. Estratégia de teste por correção

| Nível | Usado para | Ferramenta | Onde |
|---|---|---|---|
| **Unitário** | regras puras (limites de provisionamento, política de fail-closed, escape) | Vitest (introduzir) | `src/domain/**/*.test.ts` |
| **Contrato** | isolamento por modelo, manifesto de rotas | Node + Prisma | `scripts/`, `tests/api` |
| **API (integração)** | limites, health, 503, advisory lock | Playwright `--project=api` | `tests/api/*.spec.ts` |
| **Manual** | fluxo de onboarding com e-mail real | checklist | por release |

**Regra:** cada E-x entra com pelo menos um teste na camada mais barata que ainda prove a propriedade. Correções de segurança **não** entram como "testado manualmente".

> Pré-requisito técnico: o CI ainda não roda E2E (falta Postgres efêmero). **Habilitar o job `e2e` do `.github/workflows/ci.yml` no E1** — sem isso, metade dos testes deste plano não executa.

---

## 7. Decisões (resolvidas em 03/11/2026)

| # | Decisão | **Resolvido** | Consequência para a execução |
|---|---|---|---|
| **D1** | Self-service continua aberto? | ✅ **Aberto com verificação de e-mail** | `provisionTenant` cria o tenant em `contractStatus: 'pending_verification'`; `aiCredits` inicial **0**; libera os 20 créditos do trial e muda o status quando o e-mail é confirmado (token de 24 h, reutilizando a infra de e-mail existente) |
| **D2** | Política quando o Redis cai | ✅ **Fail-closed apenas nas rotas de login** | `login`, `register`, `forgot-password`, `reset`, `unlock`, `onboarding` → 503 + `Retry-After`; todo o resto do app continua funcionando; `/api/health` reporta `redis: down` |
| **D5** | Teto de créditos de IA por trial | ✅ **100 créditos/dia no total** | Contador diário global em `provisionTenant`; ao atingir, o tenant é criado com `aiCredits: 0` e entra em fila de revisão manual (não bloqueia o cadastro) |
| D3 | Superadmin por SSO obrigatório? | ⏳ **pendente** (necessário só no E2.1, semana 2) | recomendação mantida: senha desabilitada, login só por Google `@pontufy.com` |
| D4 | Repositório privado? | ⏳ **pendente** (necessário só no E3.4, semana 3) | recomendação mantida: privado, ou secret scanning no CI |

Com D1 e D2 definidas, o **E1.1 e o E1.2 estão desbloqueados**. D3 e D4 têm prazo próprio e não impedem o início.

---

## 8. Critérios de aceite do plano (o que significa "terminou")

| Métrica | Hoje | Fim do E3 |
|---|---|---|
| Caminhos que criam `Tenant` | 3 | **1** |
| Controles fail-open em auth | 5 | **0** |
| Chamadas raw a modelo de tenant fora de allowlist | 36 (15 arquivos) | **0** (allowlist explícita) |
| Tempo entre mudança de papel e efeito | até 7 d | **1 requisição** |
| Crons com exclusão mútua | 0 | **4** |
| Headers de segurança | 0 | **5** |
| Rotas sem política de autorização declarada | 0 (V1 já) | 0 |
| Ambientes | 2 | **3** (local, staging, prod) |

---

## 9. Riscos de regressão e como mitigar

| Correção | Risco | Mitigação |
|---|---|---|
| V3 | time comercial perde auto-cadastro instantâneo | tenant `pending_verification` + e-mail de confirmação (não erro) |
| V4 | queda do Redis bloqueia login | alerta + `/api/health` + janela de manutenção comunicada |
| V2 | regra de lint quebra PRs legítimos | allowlist versionada por arquivo, revisada no PR |
| V5 | sessão de 24 h incomoda admins | refresh contínuo (`updateAge`) já cobre uso ativo |
| V7 | limites truncam relatórios de clientes grandes | 413 com mensagem explicando + export assíncrono no backlog |
| V11 | staging dobra custo de infra | usar plano free do Vercel + Postgres pequeno |

---

## 10. Primeiros 5 dias, em ordem

| Dia | Manhã | Tarde |
|---|---|---|
| 1 | Responder D1, D2, D5 · E1.1 (domínio `provisionTenant` + testes unitários) | E1.1 (rotas e fluxo Google) |
| 2 | E1.1 (migração de estado pendente + e2e) · **habilitar job e2e no CI** | E1.2 (`security-controls` + política auth) |
| 3 | E1.2 (health + 503 + testes) | E1.3 (`platform-db.ts` + regra ESLint) |
| 4 | E1.3 (allowlist dos 15 arquivos + teste de contrato) | E2.1 (sessionVersion + revalidação) |
| 5 | E2.1 (SSO superadmin + maxAge) | Fechamento: gates verdes, revisão de PR, demo |

**Saída da semana:** os três riscos que um atacante usa de fato (V3, V4, V2) fechados com teste, V5 a caminho.
