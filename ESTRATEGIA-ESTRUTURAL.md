# Reforço estrutural — próximos passos estratégicos

**Contexto:** escrito ao final da Fase 1 (bloqueadores fechados) e no meio da Fase 2 (integridade).
**Escopo deste documento:** o que muda a *forma* do sistema — não os bugs restantes, que já estão no [PLANO-DE-ACAO.md](PLANO-DE-ACAO.md).
**Horizonte:** 90 dias, em 3 ondas.

---

## 1. Onde estamos

A aplicação está funcional e, desde a Fase 1, não tem mais nenhuma falha conhecida que permita forjar, duplicar ou gastar pontos indevidamente. O que resta não é uma lista de defeitos: são **cinco características estruturais** que fazem os defeitos reaparecerem em código novo.

| # | Característica estrutural | Sintoma observável hoje |
|---|---|---|
| E1 | **Modelo de dados sem invariantes** | 0 `enum` em 483 linhas de schema; estado é `String` livre; JSON em `String @db.Text`; saldo denormalizado sem lote de origem |
| E2 | **Domínio acoplado ao Prisma** | As regras de dinheiro só rodam com Postgres no ar; `Tx` precisou de `asPointsTx` para burlar o tipo do client estendido |
| E3 | **Falha silenciosa por padrão** | 90 `console.*`, zero Sentry/OTel, `catch {}` em pontos críticos, nenhum SLO |
| E4 | **Entrega sem barreira entre ambientes** | Preview e produção apontam para o mesmo banco; migração aplicada manualmente; sem staging |
| E5 | **Fronteira server/client indefinida** | 17 de 34 páginas são `'use client'`; saldo vive em zustand + SWR + `useState`; design system duplicado |

Cada onda abaixo ataca um conjunto coerente. Nenhuma começa antes da Fase 2 fechar.

---

## 2. Arquitetura alvo (em uma página)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ app/            páginas RSC · server actions · adapters HTTP (thin)      │
├──────────────────────────────────────────────────────────────────────────┤
│ domain/         regras puras (sem Prisma)                                │
│   ├─ points/    Ledger + Lots (fonte da verdade do saldo)                │
│   ├─ learning/  progresso, quiz, certificação                            │
│   └─ rewards/   catálogo, resgate, comissão                               │
├──────────────────────────────────────────────────────────────────────────┤
│ application/    casos de uso + ports (interfaces)                        │
│   ports: LedgerRepository, RewardRepository, EventBus, Clock, Mailer     │
├──────────────────────────────────────────────────────────────────────────┤
│ infra/          adapters concretos (Prisma, Redis, Resend, Lomadee…)     │
└──────────────────────────────────────────────────────────────────────────┘

Regra de ouro: `domain/` não importa `@prisma/client` nem `next/*`.
Teste unitário de regra de negócio passa a ser `vitest` puro, milissegundos.
```

Três mudanças habilitam isso: **portas explícitas** (E2), **ledger por lote** (E1) e **outbox de eventos** (E3 — notificação/auditoria deixam de ser fire-and-forget).

---

## 3. As três ondas

### Onda A — "O banco vira a verdade" (semanas 1–4)

Objetivo: eliminar a classe de bug que já causou dois incidentes (saldo e expiração).

| Iniciativa | Entrega | Critério de aceite | Esforço |
|---|---|---|---|
| **A1 · Ledger por lote (`PointsLot`)** | Tabela `PointsLot { userId, amount, remaining, expiresAt, sourceLedgerId }`; `debit` consome lotes FIFO; expiração por lote com `sourceLotId` reversível | Script de reconciliação prova `sum(remaining) == User.pointsBalance` em 100% dos usuários; expiração deixa de consumir pontos novos | 5 d |
| **A2 · Enums de domínio** | `Role`, `Plan`, `ContractStatus`, `CourseStatus`, `LedgerType`, `RedemptionStatus`, `CommissionStatus`, `NotificationType` | Migração com backfill validado; qualquer valor fora do enum passa a ser rejeitado pelo banco | 3 d |
| **A3 · JSON nativo** | `quizJson`/`questionsJson` → `Json`; validação Zod na escrita | Nenhum `JSON.parse` + `try/catch` em código de produção | 1 d |
| **A4 · Reconciliação contínua** | Job diário que compara saldo × ledger e emite alerta (não corrige sozinho) | Alerta dispara em ambiente de teste com divergência injetada | 1 d |

**Marco A:** invariante de saldo verificável e auditável; expiração reversível.

---

### Onda B — "Falhar alto" (semanas 5–8)

Objetivo: trocar "deu erro em algum lugar" por "sabemos qual erro, de quem, em quanto tempo".

| Iniciativa | Entrega | Critério de aceite | Esforço |
|---|---|---|---|
| **B1 · Observabilidade** | Sentry (`onRequestError`) + `requestId` propagado no logger + `LOG_LEVEL` | Um 500 em produção chega com stack, usuário, tenant e request-id correlacionado | 2 d |
| **B2 · Health real** | `/api/health` (DB `SELECT 1` + Redis `PING`), `/api/ai/health` aposentado como probe | Probe responde em < 300 ms, sem auth e sem chamar LLM | 0,5 d |
| **B3 · Outbox de eventos** | Tabela `OutboxEvent`; notificação, auditoria e e-mail saem de fire-and-forget para "grava + worker processa" | Métrica de eventos pendentes = 0 com tolerância; falha de e-mail não se perde | 4 d |
| **B4 · SLOs mínimos** | Latência p95 de `/api/lessons/complete` e `/api/rewards/redeem`; taxa de erro; lag do outbox | Painel com 3 SLOs e alerta em degradação | 1 d |
| **B5 · Auditoria sem buraco** | `AuditLog.tenantId` nullable + tenant `system` real; `logAudit` propaga erro em caminho crítico | Evento de cron e de plataforma aparecem na trilha | 1 d |

**Marco B:** incidente em produção é detectado em minutos, com contexto suficiente para agir sem reproduzir.

---

### Onda C — "Entregar sem susto" (semanas 9–12)

Objetivo: poder mudar o sistema sem medo de quebrar produção.

| Iniciativa | Entrega | Critério de aceite | Esforço |
|---|---|---|---|
| **C1 · Ambiente de staging** | Projeto Vercel + banco Postgres separado; `main` → produção, `staging` → staging | Preview nunca aponta para o banco de produção | 1 d |
| **C2 · E2E no CI com banco efêmero** | `services: postgres:16` no workflow; suíte completa por PR | PR que quebra resgate/aula é bloqueado automaticamente | 2 d |
| **C3 · Testes de domínio (Vitest)** | 60+ testes de `points`, `learning`, `rewards` sem banco | `npm run test:unit` < 10 s; cobertura de domínio ≥ 70% | 4 d |
| **C4 · Feature flags** | Flags por tenant (`redis` ou tabela) para rollout de mudanças em pontos/certificados | Rollback de feature em < 1 min, sem deploy | 2 d |
| **C5 · Frontend: fronteira explícita** | 4–6 páginas migradas para RSC + server actions; um único store de saldo; `marketplace/*` removido | `'use client'` só onde há interação; saldo com uma fonte | 5 d |

**Marco C:** merge em `main` com confiança; rollback em minutos, não em horas.

---

## 4. Decisões que precisam de você (não são técnicas)

| # | Decisão | Opções | Recomendação | Bloqueia |
|---|---|---|---|---|
| D1 | **Redis é obrigatório?** | (a) obrigatório em prod, boot falha sem ele (b) opcional com fallback em memória | (a) — hoje significa 5 lógicas a menos para manter; o core já não depende dele | Onda B |
| D2 | **Ambiente de staging** | (a) criar projeto Vercel + DB (b) usar só o CI | (a) — sem staging, o único teste real é produção | Onda C |
| D3 | **Escopo de produto: quanto do MVP é real?** | Cupom falso, sync mock, `/api/cron/rewards-sync` | Cortar o que é mock; publicar o que é real. Feature falsa destrói confiança mais que ausência | Onda C |
| D4 | **Contrato com a Lomadee** | HMAC no postback? paginação de catálogo? | Abrir conversa; hoje assumimos 50 itens/página e token estático | Onda A |
| D5 | **Política de retenção de dados (LGPD)** | Prazo para `PointsLedger`, `AuditLog`, `Notification` | Definir antes de crescer; hoje nada expira | Onda B |

---

## 5. Cinco ADRs a escrever (meia página cada)

1. **ADR-001 · Saldo é derivado de lotes, não de um inteiro.** Justifica `PointsLot`, expiração FIFO e reconciliação.
2. **ADR-002 · O domínio não conhece o Prisma.** Define portas, fronteira de transação e como o outbox participa.
3. **ADR-003 · Migrações são expand/contract e nunca destrutivas no mesmo deploy.** Regras de DDL, janela de compatibilidade e rollback.
4. **ADR-004 · Toda mutação de pontos é auditável e idempotente.** Chave de idempotência, quem escreve no ledger, o que nunca pode ser `UPDATE`.
5. **ADR-005 · Falha de integração não pode ser silenciosa.** Onde é permitido `catch {}` (e onde é proibido), com checklist de revisão.

---

## 6. Métricas de sucesso do trimestre

| Métrica | Hoje | 90 dias |
|---|---|---|
| Invariante de saldo verificável automaticamente | não | sim (job diário) |
| Tempo para detectar um 500 em produção | horas/desconhecido | < 2 min |
| Tempo para reverter uma mudança de risco | ~30 min (deploy) | < 1 min (flag) |
| Testes unitários de domínio | 0 | ≥ 60 |
| Cobertura dos fluxos de dinheiro por teste automatizado | parcial | ≥ 80% |
| `enum` no schema Prisma | 0 | 8 |
| Endpoints com health check real | 0 | 1 |
| Ambientes separados (prod/staging/local) | 2 | 3 |

---

## 7. Ordem recomendada — e o que **não** fazer agora

**Sequência:** Fase 2 (em curso) → Onda A → Onda B → Onda C.
Dentro de cada onda, o item de maior risco primeiro (A1, B1, C1).

**Não fazer neste trimestre** (por custo/benefício):
- Microsserviços, filas dedicadas, Kubernetes — a escala atual não justifica.
- Reescrever o frontend em outro framework — o problema é de fronteira, não de framework.
- Migrar de Prisma para outro ORM — o ORM não é o gargalo; o modelo é.
- Multi-região / DR — antes de staging e observabilidade, é otimização prematura.

---

## 8. Como isso se conecta ao plano tático

```
Fase 1  ✅ bloqueadores (feito)
Fase 2  🔄 integridade: Stripe, Lomadee, corridas, deploy fail-closed
Onda A  → modelo de dados (A1–A4)        ┐
Onda B  → observabilidade (B1–B5)        ├─ substituem a "Fase 3" tática
Onda C  → entrega segura + frontend (C1–C5) ┘
```

A Fase 3 do plano tático continua válida como lista de tarefas; as ondas dão a **ordem de dependência** entre elas (não adianta feature flag sem observabilidade, nem staging sem migração fora do build).
