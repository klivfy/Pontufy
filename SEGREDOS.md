# Inventário de segredos e rotação

**V8 do [SEGURANCA-ESTRUTURAL.md](SEGURANCA-ESTRUTURAL.md).** Nenhum valor deve ser escrito neste arquivo — apenas nome, finalidade, onde vive e quando rotacionar.

## Produção (Vercel → Settings → Environment Variables)

| Segredo | Finalidade | Obrigatório | Rotação | Efeito da rotação |
|---|---|---|---|---|
| `AUTH_SECRET` | assina o JWT de sessão | **sim** | 90 dias ou sob suspeita | **derruba todas as sessões** (avisar antes) |
| `DATABASE_URL` | conexão pooled (PgBouncer) | **sim** | ao trocar de projeto/credencial | reinício sem downtime se o pooler permitir |
| `DIRECT_URL` | conexão direta para migração | sim (migração) | idem | — |
| `CRON_SECRET` | Bearer dos 4 crons | **sim** | 90 dias | crons falham até atualizar o `vercel.json`/agendador |
| `AFFILIATE_WEBHOOK_SECRET` | HMAC do postback de afiliados | **sim** | 90 dias | postbacks recusados (503/401) até o parceiro atualizar |
| `LOMADEE_POSTBACK_SECRET` | token do postback Lomadee | **sim** | 90 dias | postbacks recusados |
| `CERTIFICATE_VERIFICATION_SECRET` | HMAC dos certificados | **sim** | **nunca** (rotação invalida todos os certificados já emitidos) | certificados antigos passam a "inválido" |
| `UPSTASH_REDIS_REST_URL/TOKEN` | rate limit, lockout, revogação | **sim** | 180 dias | sem Redis a **autenticação fica fail-closed (503)** |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | billing | sim (billing) | 180 dias / 90 dias | webhook pare de processar até recriar no dashboard |
| `RESEND_API_KEY` | e-mail transacional | recomendado | 180 dias | e-mails caem no console |
| `LOMADEE_APP_TOKEN` / `LOMADEE_SOURCE_ID` | catálogo | para a loja | 180 dias | sync e vitrine param |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | geração de curso | ao menos uma | 180 dias | geração falha / cai no fallback |

**Nunca versionar:** `.env`, `.env.local`, `.env.*.local`, `.claude/`, chaves `.pem`/`.key`.

## Segredos locais (não vão para produção)

| Nome | Uso |
|---|---|
| `SEED_ADMIN_PASSWORD` | bootstrap local (`scripts/check-and-seed.ts`); mín. 12 chars |
| `SETUP_SECRET` / `SETUP_ADMIN_PASSWORD` | endpoint `/api/setup/seed` (404 fora de dev); mín. 24 / 12 |

## Procedimento de rotação (ordem importa)

1. **Antes**: verificar `/api/health` (200) e anotar o horário.
2. Gerar o novo valor (`openssl rand -hex 32`).
3. Atualizar na Vercel em **Production e Preview** (nunca só em um).
4. Republicar (redeploy) — variáveis só valem após novo deploy.
5. Validar: `/api/health` 200, login funcionando, cron respondendo 200 com o novo Bearer.
6. Registrar data e responsável na tabela acima (no PR, não aqui).

**Caso especial — `AUTH_SECRET`:** todos os usuários são deslogados. Comunicar antes e preferir janela de baixa utilização.

**Caso especial — `CERTIFICATE_VERIFICATION_SECRET`:** não rotacionar sem um plano de reemissão. Todos os certificados já emitidos passam a não validar (a verificação compara o HMAC do payload salvo).

## Exposição conhecida

- O repositório `klivfy/Pontufy` é **público**. Enquanto isso valer, qualquer segredo commitado por engano deve ser considerado comprometido no instante do push. Recomendação: tornar privado (decisão **D4**) ou habilitar *secret scanning* + *push protection* no GitHub.
- O histórico foi varrido em 03/11/2026: nenhum segredo real encontrado (apenas placeholders em `.env.example` e um dummy de CI).
