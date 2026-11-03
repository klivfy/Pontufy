# Estudo de vulnerabilidades estruturais — Pontufy

**Data:** 03/11/2026 · **Escopo:** `apps/pontufy` (pós Fase 1 e Fase 2)
**Plano de correção derivado deste estudo:** [PLANO-CORRECAO-ESTRUTURAL.md](PLANO-CORRECAO-ESTRUTURAL.md) (3 sprints, ~16 dev-days)
**Método:** mapeamento de superfície (63 rotas, 34 páginas), análise de fronteiras de confiança, verificação de cada achado no código com `arquivo:linha`, e revisão do que já foi corrigido nas Fases 1–2 para não repetir achados.
**Diferença em relação à [ANALISE-TECNICA.md](ANALISE-TECNICA.md):** aquele documento lista **defeitos** (corrigíveis um a um). Este lista **características da forma do sistema** que produzem defeitos novos em código novo — e que não somem com patch.

---

## 1. Sumário executivo

A aplicação não tem, hoje, uma vulnerabilidade estrutural que permita acesso não autenticado a dados de tenant, injeção de SQL ou XSS. Os controles *existem* e funcionam: autorização presente em todas as 13 rotas administrativas, isolamento por interceptor, SQL sempre parametrizado, zero `dangerouslySetInnerHTML`, hash de senha canônico, assinatura de webhook validada.

O problema é outro, e é mais barato de explorar do que parece: **as garantias dependem de disciplina humana, não de barreiras mecânicas**. Encontrei 11 vulnerabilidades estruturais. As três que mais importam:

| # | Vulnerabilidade estrutural | Impacto | Explorável por |
|---|---|---|---|
| **V1** | Autorização descentralizada, `/api` fora do proxy, sem teste de cobertura | Uma rota nova sem cheque vira escalada de privilégio silenciosa | qualquer usuário |
| **V3** | Provisionamento self-service em 2 caminhos, só um protegido | Farm de tenants e de créditos de IA (custo real de LLM) | qualquer pessoa com e-mail |
| **V4** | Controles de segurança dependem de infra opcional e falham **abertos** | Sem Redis: rate limit, lockout e revogação de sessão desligados em silêncio | qualquer atacante, se o Redis cair |

Nenhuma delas é um CVE. Todas são a diferença entre "o sistema é seguro porque fizemos certo" e "o sistema é seguro porque **não dá** para fazer errado".

---

## 2. Mapa de superfície de ataque

**63 rotas de API** — classificação mutuamente exclusiva (verificada por leitura de cada arquivo):

| Guarda | Rotas | Observação |
|---|---|---|
| `requireHrAdmin` (helper central) | 7 | `admin/rewards`, `admin/skills`, `admin/skills/pdi`, `billing`, `billing/checkout`, `billing/portal`, `rewards` (PATCH) |
| Cheque inline `role !== 'admin_rh'` | 7 | `admin/{ai-status, audit-logs, branding, reports/export, users/import, users/invite}`, `invitations` |
| Cheque inline `admin_rh \|\| super_admin` | 3 | `admin/analytics`, `admin/payroll/export`, `ai/health` |
| `auth()` + papel + domínio `@pontufy.com` | 2 | `superadmin/security/ips`, `superadmin/tenants/[id]/credits` |
| `getSessionContext` (só autenticação) | 24 | correto para rotas de colaborador |
| `authorizeCronRequest` (Bearer) | 4 | fail-closed desde a Fase 1 |
| Assinatura/segredo | 4 | `webhooks/stripe`, `webhooks/affiliates`, `postback/lomadee`, `setup/seed` |
| Públicas + 3 aliases de handler protegido | 12 | 9 realmente públicas (auth, onboarding, convite, seed) |

**Resultado:** as 12 rotas `/api/admin/*` e as 2 de superadmin **têm** controle de papel. Não há escalada aberta hoje — o problema é que essas 14 rotas usam **4 estilos diferentes** para dizer a mesma coisa.

**Fronteiras de confiança (quem confia em quê):**

```
Internet
  │
  ├─► /api/*  ─────────────► handler (authN/authZ PRÓPRIA, sem middleware)
  │       ▲                        │
  │       └── proxy NÃO cobre /api ┘        ← V1
  │
  ├─► páginas ──► proxy (RBAC declarativo) ──► RSC
  │
  └─► webhooks ──► assinatura (fail-closed) ──► domínio
```

O ponto crítico: **apenas as páginas passam pelo `src/proxy.ts`**. O matcher é `'/((?!api|_next/static|...).*)'`, então todo `/api/*` chega ao handler sem nenhuma camada anterior. Isso é uma decisão defensável (webhooks precisam), mas transforma cada rota de API em uma fronteira única de segurança — sem rede de proteção abaixo.

---

## 3. As 11 vulnerabilidades estruturais

### V1 · Autorização descentralizada sem barreira mecânica — **ALTO**

**O que é.** Não existe um ponto único que responda "esta rota exige papel X?". A regra é aplicada de **quatro formas diferentes**, dentro de cada handler:

```ts
// estilo 1 — helper central
const { tenantId } = await requireHrAdmin();                    // admin/rewards, skills, pdi

// estilo 2 — cheque inline
if (role !== 'admin_rh') return 403;                            // audit-logs, users/import, users/invite, reports/export, ai-status

// estilo 3 — inline com dois papéis
if (role !== 'admin_rh' && role !== 'super_admin') return 403;  // analytics, payroll/export

// estilo 4 — auth() + domínio
if (session.user.role !== 'super_admin' || !email.endsWith('@pontufy.com')) return 403;
```

**Evidência.** 12 rotas `/api/admin/*` + 2 de superadmin, todas guardadas — mas por 4 estilos diferentes, e o único teste de gate existente (`tests/api/superadmin-gate.spec.ts`) cobre apenas o superadmin.

**Por que é estrutural.** O controle é *por omissão individual*. A próxima rota criada por alguém com pressa — ou por um agente de IA — nasce sem cheque, e nada falha: ela simplesmente funciona. Não há lint, não há teste de contrato, não há manifesto de rotas.

**Como fica seguro.** Manifesto declarativo único (rota → papel), validado por teste que **falha o build** quando aparece uma rota fora do manifesto:

```ts
// src/infra/route-guards.ts
export const ROUTE_POLICY = {
  'GET /api/admin/audit-logs': 'admin_rh',
  'POST /api/rewards/redeem': 'authenticated',
  'POST /api/webhooks/stripe': 'signature',
  // ...
} as const;
```
\+ teste que lê `app/api/**/route.ts`, extrai os métodos e compara com o mapa. Custo: ~1 dia. Efeito: impossível esquecer.

> **Status: mitigado neste estudo.** Implementado `scripts/check-route-guards.mjs` + `route-guards.json`, rodando no CI (`npm run check:routes`). O script enumera as 63 rotas, classifica o modelo de guarda detectado no código e falha se a rota não estiver declarada, se a declaração for órfã ou se divergir do código. Rota nova sem decisão explícita de autorização **quebra o build**.

---

### V2 · "Zero Trust" é convenção, não barreira — **ALTO**

**O que é.** A regra documentada ("nunca `prisma` direto para dado de tenant") não é verificável. O interceptor `getTenantDb` é a única barreira real, e ele é **contornável por construção**:

| Buraco | Evidência |
|---|---|
| `$queryRaw` / `$executeRaw` ignoram o interceptor | `admin/analytics:47,81` (mitigado: `tenantId` parametrizado à mão) |
| `Tenant` nunca é escopado (por design) | `infra/db.ts:127-129` |
| Escrita aninhada (`create: { children: {...} }`) passa por fora | `actions/course-generator.ts:392` |
| `upsert` só passou a ser tratado na Fase 2 | `infra/db.ts:145-150` |
| Client global exportado no mesmo módulo | `getRawPrisma()` — 6 usos |

**Números verificados:** **36 chamadas diretas** a `prisma.<modeloDeTenant>.*` em **15 arquivos** fora de `domain/` (crons, auth, seed, verificação pública). A maioria é legítima — mas nada impede a 37ª de ser um vazamento.

**Por que é estrutural.** A garantia depende de o autor lembrar. Um `prisma.user.findMany()` acidental não gera erro, não gera warning, não gera teste vermelho — só retorna dados de outro cliente.

**Como fica seguro.** Três camadas, todas mecânicas:
1. Regra ESLint `no-restricted-syntax` proibindo `prisma.<tenantModel>` fora de `src/domain` e de uma allowlist explícita (arquivos de plataforma).
2. `getRawPrisma()` movido para um módulo separado com nome hostil (`platform-db.ts`) — importar passa a ser um ato deliberado.
3. Teste de contrato por modelo (já sugerido na Fase 2) provando que leitura/escrita escopada não vaza.

> **Status: fechado.** `src/infra/platform-db.ts` é o único módulo que entrega client sem escopo (removido de `infra/db.ts` e de `backend/db.ts`). A regra `no-restricted-syntax` cobre os 19 modelos de tenant com allowlist de 19 arquivos justificados em `eslint.config.mjs`; provado por arquivo-sonda que dispara com mensagem acionável. Contrato em `tests/api/tenant-db-contract.spec.ts`: leitura cruzada, `upsert` (que passava sem escopo), `create` com `tenantId` estrangeiro e o híbrido `Reward`.

---

### V3 · Provisionamento self-service em dois caminhos, um sem controle — **ALTO**

**O que é.** Existem **três** formas de criar um tenant:

| Caminho | Controle | Evidência |
|---|---|---|
| `POST /api/tenants/onboarding` | rate limit 5/h por IP (Fase 2) + Zod | `api/tenants/onboarding` |
| Login Google, `intent=tenant` | **nenhum** | `domain/auth/google.ts:144-145` |
| Login Google, e-mail desconhecido → `createPersonalTenant` | **nenhum** | `domain/auth/google.ts:148, 282-309` |

```ts
// google.ts:282 — qualquer e-mail Google desconhecido cria empresa + trial + 20 créditos
async function createPersonalTenant(email, name) {
  const tenant = await tx.tenant.create({ data: { ..., plan: 'trial',
    trialEndsAt, aiCredits: TRIAL_AI_CREDITS, contractStatus: 'active' } });
  const user = await tx.user.create({ data: { ..., role: 'employee' } });
}
```

**Exploração.** Com N contas Google (gratuitas), crio N tenants, cada um com 20 créditos de IA → **20×N gerações de curso**, que custam dinheiro real por token. Além do custo: banco poluído, e-mails de boas-vindas disparados, e a métrica de "empresas" fica inútil.

**Por que é estrutural.** O rate limit foi aplicado **na rota**, não na **operação de negócio**. Qualquer segundo caminho para "criar tenant" nasce sem o controle. É o mesmo padrão da V1, aplicado a provisionamento.

**Como fica seguro.** Um único caso de uso `provisionTenant()` no domínio, com: limite por e-mail/domínio, verificação de e-mail antes de liberar créditos, e um teto global por dia (kill switch de custo). Os três caminhos passam a chamar essa função — e só ela cria `Tenant`.

> **Status: fechado.** `src/domain/tenant/provision.ts` é o único ponto que cria `Tenant`. O tenant nasce em `pending_verification` com `aiCredits: 0`; o e-mail (token de 32 bytes, uso único, 24 h) ativa a conta e libera os créditos via `verifyTenantEmail`. Tetos diários em `ProvisioningQuota` (banco, não Redis): 50 tenants/dia e 100 créditos de IA/dia, ambos configuráveis. `createPersonalTenant` foi **removido** — login Google com e-mail desconhecido exige intenção explícita. Testes em `tests/api/provisioning-limits.spec.ts`.

---

### V4 · Controles de segurança dependem de infraestrutura opcional e falham abertos — **ALTO**

**O que é.** Redis (Upstash) é a base de 5 controles. Sem ele, todos degradam **em silêncio** para "permitir":

| Controle | Sem Redis | Evidência |
|---|---|---|
| Rate limit por IP | `{ allowed: true }` | `infra/redis.ts:114-116,135-137` |
| Account lockout | nunca bloqueia | `lib/security/auth-guard.ts:47-51` |
| Revogação de sessão (`revoke-all`) | não faz nada | `api/auth/revoke-all:13-17` |
| Quota de geração de IA (10/dia) | ilimitada | `actions/course-generator.ts:304` |
| SSE / badge | degrada | `infra/redis.ts` |

**Exploração.** Se o Upstash expirar (plano, cartão, região), o app continua funcionando — e o login passa a aceitar força bruta ilimitada, sem nenhum sinal. O `.env.example` só passou a dizer "obrigatório em produção" na Fase 1; o **código** continua fail-open.

**Por que é estrutural.** O estado seguro não é o padrão: `getRedis()` devolve `null` e o `if (!redis) return allow` está espalhado. Cada novo controle tende a repetir o padrão.

**Como fica seguro.** Inverter o padrão: um único módulo `securityControls` que, sem Redis, **falha fechado nos endpoints de autenticação** (503 + alerta) e só mantém fail-open em caminhos não sensíveis. Mais: `/api/health` reportando `redis: down` e alerta quando cair.

> **Status: fechado.** `src/infra/security-controls.ts` centraliza a política: `enforceIpRateLimit()` distingue `allowed | blocked | unavailable` e os caminhos de autenticação (`register`, `forgot-password`, `reset`, `unlock`, `onboarding`, `verify`, login NextAuth) respondem **503** quando não há infra. O restante do app segue funcionando. `/api/health` (público, sem LLM) expõe `db`, `redis` e `auth` para monitoração. Testes em `tests/api/security-infra.spec.ts`.

---

### V5 · Sessão de 7 dias com autorização lida do token — **MÉDIO-ALTO**

**O que é.** `maxAge: 7 dias` (`auth.config.ts:79-85`); o `role` vem do JWT, não do banco. As rotas de superadmin leem `session.user.role` (`superadmin/tenants/[id]/credits:11-18`, `superadmin/security/ips:8-15`). Rebaixar ou remover um usuário **não tem efeito até o token expirar**.

**Agravantes estruturais:**
- `revoke-all` depende de Redis (V4) → sem Redis, a única forma de cortar acesso é esperar 7 dias ou rotacionar `AUTH_SECRET` (derruba todos).
- **Não há MFA** para `super_admin` — o papel mais poderoso da plataforma é protegido por uma senha.
- `getSessionContext` revalida usuário+tenant no banco (bom), mas **só nas rotas de tenant**; as de superadmin não revalidam.

**Por que é estrutural.** O modelo de sessão não prevê mudança de privilégio. Toda autorização é "assíncrona" ao estado do banco.

**Como fica seguro.** Revalidação de papel/status nas rotas privilegiadas (1 query) ou `maxAge` curto com refresh; coluna `sessionVersion` no `User` (funciona sem Redis) + `status` de conta; MFA/TOTP obrigatório para `super_admin`.

> **Status: fechado (parte 1).** `User.sessionVersion` no banco é comparada pelo `getSessionContext` na query que ele já fazia — revogação funciona sem Redis. `requireSuperAdmin()` relê papel e domínio do banco (as 2 rotas e a página deixaram de confiar no token). `maxAge` caiu de 7 dias para 24 h com `updateAge` de 1 h. Testes em `tests/api/session-revocation.spec.ts`.
> **Pendente (D3):** superadmin obrigatoriamente por SSO Google. Sem dependência nova, mas é decisão de produto sobre o fluxo de acesso ao papel mais poderoso.

---

### V6 · Processamento de arquivo não confiável sem orçamento de recursos — **MÉDIO**

**O que é.** `POST /api/files/extract` (`api/files/extract/route.ts`):
- `formData.getAll('files')` **sem limite de quantidade** (`:21`);
- valida **extensão**, não MIME real (`:32`);
- `MAX_FILE_SIZE = 10 MB` (`:4`) — **acima** do limite de 4.5 MB de corpo da Vercel, ou seja, o número é decorativo;
- `pdf-parse` e `mammoth` rodam **em memória** no mesmo processo que atende todos (`:83-95`);
- sem rate limit e sem quota por tenant.

**Exploração.** Um colaborador autenticado pode enviar lotes de PDFs grandes e derrubar/encarecer a função (memória e CPU), ou usar um PDF malformado para exercitar o parser.

**Por que é estrutural.** Não existe política de "orçamento de recurso por requisição" para entrada binária. Qualquer feature futura que aceite arquivo (import de planilha, avatar, vídeo) herda o problema.

**Como fica seguro.** Validação de MIME por *magic bytes*, limite de N arquivos e M bytes por requisição, `AbortSignal`/timeout no parse, processamento em rota isolada com `maxDuration` próprio, e quota por tenant.

---

### V7 · Consultas sem limite e jobs sem exclusão mútua — **MÉDIO**

**O que é.** Crescimento não tem teto em vários caminhos:

| Caminho | Problema | Linha |
|---|---|---|
| `cron/expire-points` | `findMany` de **todo** o ledger antigo (todos os tenants) | `:22-32` |
| `admin/reports/export` | carrega **todas** as completions do tenant | `:31-38` |
| `engagement/streak` | `findMany` de **todas** as conclusões do usuário | `streak.ts:50-54` |
| `engagement/ranking` | 2 `groupBy` sobre todo o `PointsLedger` | `streak.ts:199-211` |
| `cron/sync-lomadee` | loop HTTP sequencial sobre todo o catálogo | `:70-89` |

E os 4 crons não têm **lock de execução única**: dois disparos sobrepostos (retry da Vercel + cron) processam o mesmo lote.

**Por que é estrutural.** Não há convenção de paginação nem de idempotência de job. O código cresce em volume de dados mais rápido que em disciplina de leitura.

**Como fica seguro.** Cursor obrigatório (`take` + `cursor`) em varreduras; lock de job (`cron:{nome}` no Redis, ou `advisory lock` no Postgres — este funciona sem Redis); métrica de duração por job.

> **Status: fechado (parte 1).** `src/infra/job-lock.ts` dá exclusão mútua aos 4 crons por claim de TTL **em tabela** — advisory lock por sessão não é confiável atrás de pooler (acquire e release podem cair em conexões diferentes). Varreduras ganharam teto: `expire-points` (5.000 linhas/execução, com `truncated` na resposta), `streak` (janela de 400 dias), `reports/export` (50.000 linhas → 413). Testes em `tests/api/job-lock.spec.ts`.
> **Pendente:** `getXpLeaderboard` ainda faz dois `groupBy` sem janela de tempo (ranking histórico é requisito de produto — precisa de decisão antes de cortar).

---

### V8 · Segredos, ambiente e cadeia de suprimentos — **MÉDIO**

**O que é.** Um conjunto de fragilidades que se somam:

| Item | Evidência | Risco |
|---|---|---|
| Repositório **público** com documentos que descrevem o backdoor antigo e o e-mail do superadmin | GitHub `klivfy/Pontufy` | Reconhecimento facilitado |
| `AUTH_SECRET` reutilizado como HMAC de URLs assinadas e (antes) API key do setup | `signed-urls.ts:3` (código morto), `setup/seed` (corrigido) | Rotação quebra vários pontos |
| Nenhuma política de rotação de segredos | — | Credencial comprometida vive para sempre |
| `.claude/settings.local.json` **versionado** com `mcp__…__deploy_to_vercel` e `Bash(npm install *)` | `apps/landing/.claude/settings.local.json` | Agente de IA com permissão de deploy no repo |
| `tests/global-setup.ts` **apaga ledger** de usuários reais se apontado para produção | `:160-175` | Destruição de dados por engano |
| Sem backup automatizado documentado | `PRODUCTION.md` | Sem recuperação |

**Por que é estrutural.** Não há modelo de ameaça operacional: quem acessa o quê, por quanto tempo, e como se revoga. Segurança de aplicação é tratada como código; segurança de operação não existe.

**Como fica seguro.** Inventário de segredos com dono e prazo de rotação; repositório privado (ou varredura de segredos no CI); `.claude/` fora do versionamento; guarda dura no `global-setup` (recusa se `NODE_ENV=production` ou host ≠ localhost); backup diário com restore testado.

---

### V9 · Vazamento por canais secundários — **MÉDIO**

**O que é.** Dados saem por caminhos que não passam pelo "canal principal" de autorização:

| Canal | Estado |
|---|---|
| SSE por tenant entregava notificação de colegas | **corrigido** (Fase 2) |
| Service Worker cacheava HTML autenticado | **corrigido** (Fase 2) |
| CSV formula injection em `admin/reports/export` | **corrigido neste estudo** (passou a usar `buildCsvRow`/`sanitizeCsvField`) |
| `GET /api/admin/branding` devolvia `aiCredits` para qualquer autenticado | **corrigido neste estudo** (só `admin_rh`/`super_admin`) |
| Log do `appToken` da Lomadee na URL | **corrigido neste estudo** (`requestJson` mascara token/UUID no log) |
| E-mail de certificado interpola nome/curso/empresa sem escape | **aberto** (`certificate-service.ts:149-162`) |
| `/verify/<uuid>` expõe nome do colaborador publicamente | por design — mas sem `noindex`/rate limit |

**Por que é estrutural.** Não há **DTO de saída**: as rotas devolvem o objeto do Prisma. Todo campo novo no schema vira campo exposto automaticamente. Foi assim que `aiCredits` vazou; o próximo campo sensível (salário, CPF, e-mail) vazaria igual.

**Como fica seguro.** `select` explícito obrigatório em respostas (regra de lint/revisão), serializador por recurso, e `escapeHtml` como utilitário único usado em todo template de e-mail.

---

### V10 · Ausência de defesa em profundidade HTTP — **BAIXO-MÉDIO**

**O que é.** `next.config.ts` tem 14 linhas e nenhum header de segurança: sem CSP, `X-Content-Type-Options`, `Referrer-Policy`, `HSTS`, `Permissions-Policy` (`next.config.ts:1-12`). Não há limite de payload próprio nem validação de `Content-Type` nas rotas mutantes. CSRF é mitigado apenas por `SameSite=Lax` (`auth.config.ts:95`).

**Por que é estrutural.** Defesa em profundidade não foi projetada — foi herdada do framework. Quando um XSS aparecer (uma lib de markdown, um `dangerouslySetInnerHTML` futuro), não haverá CSP para conter.

**Como fica seguro.** `headers()` no `next.config.ts` com CSP por nonce (o App Router suporta), e um teste de smoke que falha se os headers sumirem.

---

### V11 · Configuração de runtime sem processo — **BAIXO**

**O que é.** As Fases 1 e 2 fecharam os buracos concretos (env obrigatório no boot, migração fail-closed, migração fora do build), mas o **processo** continua frágil: sem staging, sem `_prisma_migrations` monitorado, sem alarme quando um deploy falha, sem rollback testado.

**Por que é estrutural.** A aplicação depende de uma única etapa manual (aplicar migração) que ninguém é obrigado a executar — e o deploy é independente dela.

**Como fica seguro.** Pipeline em que migração e deploy são o **mesmo job** (migração falha ⇒ deploy não acontece), staging obrigatório, e `migrate status` como *gate* antes do build.

---

## 4. Matriz de defesa em profundidade

| Camada | Prevenção | Detecção | Resposta |
|---|---|---|---|
| Identidade | senha scrypt ✅, lockout (fail-open ⚠️ V4) | `LOGIN_FAILED` no audit ✅ | revogação (fail-open ⚠️) · MFA ❌ V5 |
| Autorização | por rota (descentralizada ⚠️ V1) | ❌ nenhum alerta de 403 anômalo | ❌ |
| Isolamento | interceptor ✅ + 36 exceções ⚠️ V2 | ❌ nenhum teste de contrato | ❌ |
| Dados | `CHECK` de saldo ✅, transações ⚠️, idempotência parcial | ❌ reconciliação de saldo | ❌ |
| Entrada | Zod ✅ (rotas de dinheiro), arquivo ⚠️ V6 | ❌ | ❌ |
| Saída | React escapa ✅, `select` explícito ❌ V9 | ❌ | ❌ |
| Borda HTTP | sem headers ⚠️ V10 | ❌ | ❌ |
| Operação | env fail-fast ✅, migração fail-closed ✅ | ❌ Sentry/alertas V11 | backup ❌ |

Legenda: ✅ existe e funciona · ⚠️ existe com falha estrutural · ❌ ausente.

A leitura da matriz é o resumo do estudo: **prevenção está razoavelmente coberta; detecção e resposta praticamente não existem.** O sistema hoje é bom em *não deixar acontecer* e ruim em *perceber que aconteceu*.

---

## 5. O que está sólido (não gastar energia aqui)

1. **Sem XSS de HTML injetado:** zero `dangerouslySetInnerHTML` em 112 arquivos `.tsx`; conteúdo de aula é renderizado como texto (React escapa). O `sanitizeAiHtml` é defesa extra, não a principal.
2. **Sem SQL injection:** o único SQL cru (`admin/analytics`) usa `Prisma.sql` com `${tenantId}` parametrizado.
3. **Sem `tenantId` vindo do cliente:** verificado por grep em todas as rotas — o tenant sempre sai da sessão.
4. **Senha canônica:** `scrypt` + salt 16 B + `timingSafeEqual`, com regra explícita de não reimplementar (única exceção: `users/profile`, que reimplementa — dívida, não falha).
5. **Redirect seguro:** `isSafeRelativePath` bloqueia `//` e `\`; origem validada por allowlist com fallback fixo.
6. **Convite vinculado ao e-mail** (inclusive no fluxo Google) e token CSPRNG de 32 bytes.
7. **Webhooks fail-closed** desde a Fase 1, com HMAC e janela anti-replay; Stripe valida sobre o corpo cru.
8. **IDOR coberto nos fluxos testados:** notificações, cursos, batalhas e certificados escopam por sessão + tenant.

---

## 6. Plano de correção estrutural

As correções se encaixam nas ondas da [ESTRATEGIA-ESTRUTURAL.md](ESTRATEGIA-ESTRUTURAL.md), sem criar um quarto roadmap.

| Vulnerabilidade | Correção | Onda | Esforço |
|---|---|---|---|
| V1 | Manifesto de rotas + teste que falha o build | B (curto prazo) | ~~1 d~~ **feito** |
| V2 | Regra ESLint + `platform-db.ts` + teste por modelo | A | 2 d |
| V3 | `provisionTenant()` único + verificação de e-mail + teto diário | A | 2 d |
| V4 | `securityControls` fail-closed em auth + `/api/health` expondo Redis | B | 1,5 d |
| V5 | Revalidação de papel + `sessionVersion` em DB + MFA superadmin | B | 3 d |
| V6 | MIME por magic bytes + limites + quota | C | 1,5 d |
| V7 | Cursor em varreduras + advisory lock nos crons | A | 2 d |
| V8 | Repo privado, inventário de segredos, guarda no global-setup, backup | C | 2 d |
| V9 | `select` explícito + serializador + `escapeHtml` único | C | ~~2 d~~ **parcial** (3 canais fechados) |
| V10 | Headers + CSP nonce | C | 1 d |
| V11 | Staging + migração como gate do deploy | C | 2 d |

**Ordem recomendada:** V1 → V3 → V4 (as três que um atacante usa de fato), depois V2/V7 (higiene de dados), depois V9/V10/V11 e V5/V6/V8 conforme a Onda C avançar.

---

## 7. ADRs que este estudo exige

1. **ADR-006 · Toda rota declara seu papel em um manifesto único.** Por que o cheque inline foi abandonado.
2. **ADR-007 · Tenant só nasce em `provisionTenant()`.** Unifica onboarding, Google e import.
3. **ADR-008 · Controle de segurança não degrada em silêncio.** Define fail-closed vs fail-open por controle.
4. **ADR-009 · Nenhuma resposta devolve entidade do Prisma.** DTO/serializador por recurso.
5. **ADR-010 · Sessão revalida privilégio.** Janela máxima entre mudança de papel e efeito.

---

## 8. Limitações deste estudo

- **Não testei exploração em ambiente vivo.** Tudo aqui é análise estática + leitura direta do código; os vetores descritos são reproduzíveis em teoria, mas não foram executados contra produção (não há banco acessível neste ambiente).
- **Não avaliei configuração de infraestrutura:** regras da Vercel, WAF, headers no CDN, permissões do Supabase (RLS está desativado? o app usa o Prisma com usuário de banco — vale verificar), política de senha do Postgres.
- **Não avaliei o `apps/landing` em profundidade** (é estático; risco concentrado em CTA/SEO, já documentado).
- **`origin/main` continua rodando o código antigo** — tudo o que foi corrigido nas Fases 1–2 está na branch `sec/fase-1-2`, ainda não em produção.
