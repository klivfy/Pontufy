# Plano — geração de cursos por IA

**Contexto:** o motor existe e funciona, mas nunca foi testado de ponta a ponta. Este plano fecha a lacuna de validação com APIs gratuitas, sem comprometer a arquitetura de produção.

---

## 1. Diagnóstico do motor atual

Fluxo em `src/actions/course-generator.ts` (418 linhas):

```
generateTrainingCourse (server action)
  └─ Zod: prompt (3..2000), sector, referenceContent  →  até 30k chars de material
  └─ verifica tenant.aiCredits ≥ 1
  └─ generateCourseWithFallback
       └─ buildProviderChain(): compat → Gemini → OpenAI → Anthropic
       └─ generateObject({ schema, temperature: 0.6, maxOutputTokens: 8192 })
       └─ sem sucesso em nenhum → generateLocalFallback (template determinístico)
  └─ debita 1 crédito com UPDATE condicional (aiCredits ≥ 1), só após sucesso
```

**O que já está certo:** schema tipado, fallback offline, débito atômico, multi-provedor, chave validada por formato, limite de tamanho do material de referência.

**Lacunas reais:**

| # | Lacuna | Consequência |
|---|---|---|
| L1 | Só 3 SDKs nativos; nenhum provedor OpenAI-compatible plugável | impossível testar com API gratuita sem alterar código → **corrigido nesta rodada** |
| L2 | Zero cobertura automatizada do motor | quebra de prompt/schema passa despercebida até um cliente reclamar |
| L3 | Fallback silencioso | usuário recebe template e acredita que é IA; `provider` existe na resposta, mas não é exibido de forma inequívoca |
| L4 | Sem avaliação de qualidade | schema válido ≠ curso bom (aulas repetidas, tópicos fora do material) |
| L5 | Sem telemetria por provedor | não se sabe latência, taxa de falha, tokens ou custo por geração |
| L6 | Prompt sem versionamento | impossível comparar regressão antes/depois de ajustar o prompt |

---

## 2. APIs gratuitas para testar o motor

Todas abaixo falam `POST /chat/completions`, o mesmo contrato do OpenAI — por isso entram sem SDK novo, via `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`.

| Provedor | `AI_BASE_URL` | Modelo sugerido | Limite gratuito | Observação |
|---|---|---|---|---|
| **Groq** | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` ✅ *testado* | por minuto/dia, generoso p/ teste | o mais rápido; modelo disponível varia por conta — **sempre liste** `GET /models` |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `<modelo>:free` | ~20 req/min, cota diária | agrega vários modelos; modelos `:free` mudam |
| **GitHub Models** | `https://models.github.ai/inference` | `gpt-4o-mini` | cota por token/dia | usa PAT do GitHub como chave |
| **Google Gemini** | — (SDK nativo) | `gemini-2.0-flash` | cota diária no AI Studio | já suportado; melhor qualidade free |
| **Mistral** | `https://api.mistral.ai/v1` | `mistral-small-latest` | tier "Experiment" | bom em francês/português |
| **Cerebras** | `https://api.cerebras.ai/v1` | `llama-3.3-70b` | cota diária | muito rápido |
| **Ollama** (local) | `http://127.0.0.1:11434/v1` | `llama3.2` | ilimitado, offline | ~2–4 GB de download; **zero risco de dados** |

Fontes para conferir limites (mudam com frequência): [Gemini free tier](https://apidog.com/blog/gemini-api-free-tier/), [OpenRouter](https://benchlm.ai/free-tier/openrouter), [Mistral](https://benchlm.ai/free-tier/mistral), [GitHub Models](https://github.blog/ai-and-ml/llms/solving-the-inference-problem-for-open-source-ai-projects-with-github-models/), [lista de créditos gratuitos](https://github.com/Moh4696/free-llm-credits).

> **O que foi implementado nesta rodada:** [`ai-providers.ts`](apps/pontufy/src/lib/ai-providers.ts) lê `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`/`AI_LABEL`, monta o provedor com `.chat()` (endpoint `/chat/completions` — `openai(model)` usaria a Responses API, exclusiva da OpenAI) e o coloca **antes** de Gemini na cadeia. Configuração parcial ou URL inválida é ignorada com aviso, nunca derruba a geração. Coberto por `tests/api/ai-providers.spec.ts` (7 casos, sem rede).

> **Bug real encontrado na primeira geração (e corrigido):** o schema do curso tinha `.default()` em `pointsAwarded`, `category` e `estimatedDurationMinutes`. Provedores de *structured output* estrito exigem que **toda** propriedade apareça em `required` — o request foi rejeitado com 400:
>
> ```
> invalid JSON schema for response_format:
> /properties/lessons/items/required: The following properties must be listed
> in `required`: pointsAwarded
> ```
>
> Consequência silenciosa: o motor caía no template local e o RH recebia um curso genérico sem saber. Corrigido com um schema estrito (`courseGenerationSchema`) só para a chamada ao modelo, normalizado de volta pelo canônico. Travado por `tests/api/course-schema-strict.spec.ts`.
>
> **Resultado da geração real (Groq, `openai/gpt-oss-120b`):** 8,1 s · 5 aulas (1.889–2.351 caracteres cada) · 5 questões · conteúdo aderente ao material de referência (DPO em 24 h, menor privilégio, retenção e descarte) · `correctIndex` sempre dentro das opções.

## 2.1 Resultado medido — os três provedores (bancada `npm run test:ai`)

Roda o motor real contra cada provedor isolado e depois a cadeia completa. Prompt de LGPD, material sintético de 7 itens.

| Provedor / modelo | Resultado | Latência | Saída | Configuração |
|---|---|---|---|---|
| **Groq** · `openai/gpt-oss-120b` | ✅ structured output nativo | **7,9 s** | 4 aulas · 5 questões · 10.653 chars | `schema` · 8.192 tokens |
| **Ollama Cloud** · `gpt-oss:120b` | ✅ modo JSON | 14,2 s | 5 aulas · 6 questões · 9.494 chars | `json` · 24.000 tokens |
| **OpenRouter** · `dots-studio/dots-3-note-preview:free` | ✅ | 54,7 s | 6 aulas · 6 questões · 7.985 chars | `auto` · 16.000 tokens |
| **Cadeia completa** (1 → 2 → 3) | ✅ Groq respondeu | 6,4 s | 5 aulas · 5 questões | fallback pronto |

**4/4 execuções geraram conteúdo por IA — nenhuma caiu no template.**

### Como o ambiente está montado

Slots numerados no `.env.local`, cada um independente:

```
AI_1_LABEL / AI_1_BASE_URL / AI_1_MODEL / AI_1_API_KEY
AI_1_STRUCTURED / AI_1_TIMEOUT_MS / AI_1_MAX_TOKENS
AI_2_…   AI_3_…
```

| Campo | Por que existe |
|---|---|
| `STRUCTURED` | `schema` (honra `json_schema`) · `json` (ignora — vai direto ao modo JSON, sem gastar uma chamada perdida) · `auto` (tenta e recupera) |
| `TIMEOUT_MS` | provedor lento não consome o tempo da função serverless; estourou, passa ao próximo |
| `MAX_TOKENS` | **teto por provedor** — ver achado nº 1 |

### Achados desta rodada

1. **Orçamento de tokens é por provedor, não global.** Com `COURSE_MAX_OUTPUT_TOKENS=24000` o Groq passou a falhar (`Failed to generate JSON`); com 8.192 voltou a funcionar. O mesmo teto que corrige o truncamento de modelos de raciocínio quebra o provedor de structured output. A variável era global — virou `AI_n_MAX_TOKENS`.
2. **`STRUCTURED=schema` não significa "nunca falha".** O Groq também devolve JSON fora do schema às vezes. A recuperação em modo JSON foi liberada para `schema` e `auto`; `json` continua sendo o caminho direto.
3. **A bancada tinha um bug próprio.** Ela apagava os slots para isolar um provedor e não os restaurava — o 2º e o 3º eram testados contra ambiente vazio e "passavam" caindo no template. Corrigido com snapshot/restore. É o mesmo falso-positivo que eu vinha criticando nos outros.

### Lições anteriores (mantidas)

- **Nem todo modelo `:free` suporta structured output.** Filtre por `supported_parameters` (`structured_outputs`/`response_format`) antes de escolher. Dois modelos com 1 milhão de contexto falharam nisso.
- **429 de upstream é rotina.** `gemma-4` estava limitado no Google AI Studio, não na nossa chave — a cadeia de fallback existe por isso.
- **Latência é decisão de produto.** 55 s vs 8 s separa geração síncrona de job em background.
- **"Compatível com OpenAI" ≠ "respeita `response_format`".** O Ollama Cloud aceita o parâmetro e devolve outra estrutura, em bloco markdown — origem do IA-1.5 (modo JSON).
- **Modelos de raciocínio consomem o teto em `reasoning`.** Guarda explícita de truncamento com mensagem acionável.

### ⚠️ Regra de ouro para testes
O campo `referenceContent` carrega **material interno de RH** (até 30 mil caracteres). Planos gratuitos frequentemente usam o conteúdo para treino. Portanto:

- **Teste com conteúdo sintético**, nunca com material real de cliente.
- Em produção, `AI_ALLOW_COMPAT_IN_PRODUCTION=1` só com política de dados revisada — o código já emite aviso explícito quando um provedor gratuito está ativo em produção.

---

## 3. Estratégia de teste em três camadas

| Camada | O que valida | Custo | Determinismo |
|---|---|---|---|
| **L0 — template local** | fallback, contrato de saída, UI | zero | total |
| **L1 — provedor falso** | pipeline completo: cadeia, timeout, erro 500 → próximo provedor, débito de crédito só no sucesso | zero | total |
| **L2 — provedor gratuito real** | qualidade do conteúdo, prompt, aderência ao material | cota free | baixo |

**L1 é o que falta e o que mais rende.** Um servidor HTTP local (~80 linhas) que responde `/chat/completions` com um JSON fixo permite testar em CI: schema inválido → fallback; 429 → próximo da cadeia; sucesso → 1 crédito debitado. Hoje nada disso tem teste.

**L2 não automatiza** — roda manualmente antes de release, com 3 prompts fixos, e o resultado é comparado a olho com a versão anterior.

---

## 4. Qualidade: conjunto de referência (golden set)

10 prompts sintéticos cobrindo os setores do produto (vendas, segurança da informação, LGPD, atendimento, logística...). Para cada saída, avaliar:

1. **Estrutural (automatizável):** schema válido, 3–6 aulas, cada aula com objetivo e conteúdo ≥ 200 caracteres, quiz com 3–5 questões e resposta correta entre as alternativas.
2. **Aderência (semi-automatizável):** as aulas citam ≥ 60% dos tópicos extraídos do material de referência.
3. **Idioma:** pt-BR, sem inglês vazado.
4. **Custo/latência:** tokens de entrada/saída, segundos por geração.

Saídas versionadas em `tests/fixtures/ai-golden/` para comparação estrutural (nunca textual — a saída varia).

---

## 5. Roadmap faseado

| Fase | Entrega | Critério de aceite |
|---|---|---|
| **IA-0** ✅ *(feito)* | provedor OpenAI-compatible plugável + motor extraído para `domain/ai` + schema estrito + testes de cadeia | 10 casos passando, sem rede |
| **IA-0.1** ✅ *(feito)* | **bug real corrigido:** schema com `.default()` era rejeitado por provedor estrito | geração real contra Groq em 8,1 s, 5 aulas, 5 questões |
| **IA-1** ✅ *(feito)* | provedor falso em HTTP local + 9 casos do motor: 200, 429 → próximo, lixo → template, timeout → próximo, cerca markdown, esponse_format por modo, curso inválido rejeitado | suíte roda em CI sem chave e sem cota |
| **IA-1.5** ✅ *(feito)* | fallback de structured output: repetir em modo JSON (schema no prompt + extração de cerca markdown + Zod) e guarda de truncamento | Ollama Cloud `gpt-oss:120b` passou de inútil a funcional |
| **IA-2** ✅ *(feito)* | `meta` na resposta do motor (provider, usedFallback, usedJsonMode, durationMs, attempts[], usage) + log estruturado na action | 11 asserts no spec provam o caminho de cada tentativa |
| **IA-3** (2 d) | golden set + rubrica + provedor gratuito em dev | 3 gerações comparadas, relatório em `EXECUCAO-IA.md` |
| **IA-4** (futuro) | versionamento de prompt (`COURSE_PROMPT_VERSION`) e comparação A/B | dois prompts avaliados com a mesma golden set |

**Dependência:** IA-1 não depende de nenhuma conta externa. IA-3 depende de você gerar uma chave gratuita (Groq ou Gemini) — é o único passo que só você pode fazer.

---

## 6. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Rate limit do provedor gratuito no meio de um teste | cadeia de fallback já existe; em L1 isso é testado explicitamente |
| Provedor muda o nome do modelo `:free` | `AI_MODEL` é variável de ambiente, não código |
| Material de cliente enviado a terceiro | conteúdo sintético em teste; aviso em produção; preferir Gemini/OpenAI com contrato de dados |
| Qualidade cair sem ninguém notar | golden set (IA-3) e telemetria (IA-2) |
| Geração longa estourar o limite da função serverless | `COURSE_MAX_OUTPUT_TOKENS` já é configurável; IA-2 mede a latência real por provedor |
