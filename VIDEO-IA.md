# Vídeo por IA — busca, comparação e escolha

Objetivo: descobrir o que existe de **gratuito** para gerar vídeo, e escolher 3
modelos para o motor de cursos renderizar b-roll das cenas.

Data da busca: **04/11/2026**. Preços e licenças mudam rápido; as fontes estão
citadas no fim e cada linha foi lida na data acima.

---

## 1. O que "gratuito" pode significar (e por que isso muda a resposta)

Encontrei quatro tipos de "grátis", e só dois servem para produto:

| Tipo | O que é | Serve para produção? |
|---|---|---|
| **Pesos abertos** | você baixa o modelo e roda na sua GPU. Sem cobrança por vídeo | ✅ sim, com custo de infra |
| **Licença comunitária** | grátis abaixo de um teto (receita ou usuários) | ✅ sim, se o teto for respeitado |
| **Créditos de teste** | lote inicial ou cota diária que expira | ⚠️ validar, não servir cliente |
| **Assinatura sem cartão** | começa sem pagar, trava no limite | ❌ é teste disfarçado |

Conclusão da busca, sem rodeio: **não existe API de vídeo gratuita e durável.**
O consenso entre as fontes é explícito — *"Is there a truly free AI video API?
Only if you run the model yourself"* ([Apiframe](https://apiframe.ai/blog/free-ai-video-generation-api-2026)).
Provedores hospedados cobram; o que eles chamam de grátis é crédito de entrada,
muitas vezes com marca d'água e licença de uso pessoal.

Isso não invalida a pergunta — muda a resposta. O caminho barato de verdade é
**pesos abertos + GPU alugada por minuto**, e é o que a escolha abaixo assume.

---

## 2. Os candidatos encontrados (9)

| # | Modelo | Licença comercial | Piso de VRAM | Máx. | Áudio nativo | Como é "grátis" |
|---|---|---|---|---|---|---|
| 1 | **Wan 2.2** (Alibaba) | **Apache 2.0** — sem restrição | 8 GB (5B GGUF) | 720p | não | pesos + créditos em fal/Replicate/WaveSpeed/ModelScope |
| 2 | **LTX-2.3** (Lightricks) | Community/Commercial — grátis < US$10M receita | 16 GB (distilled) | 4K, 20 s | **sim** | pesos + créditos iniciais |
| 3 | **HunyuanVideo 1.5** (Tencent) | Tencent Community — grátis < 100M MAU | 14 GB (FP8) | 1080p | não | pesos + créditos |
| 4 | **CogVideoX-2B** (Zhipu/THUDM) | **Apache 2.0** | 16 GB | 720p | não | pesos + créditos |
| 5 | CogVideoX-5B | CogVideoX License (restritiva) | 24 GB | 720p | não | pesos |
| 6 | **Mochi 1** (Genmo) | **Apache 2.0** | 20 GB (FP8) | 480p | não | pesos |
| 7 | Stable Video Diffusion | Stability Community (comercial só licenciado) | 8 GB | 576×1024 | não | só img→vídeo |
| 8 | SkyReels V2 (Skywork) | `other` — não permissiva clara | 12 GB+ | 540p+ | não | pesos |
| 9 | Open-Sora 2.0 | verificar antes de usar | 24 GB+ | 720p | não | pesos |

Hospedagens com crédito de entrada (não são modelos, são portas de acesso):
fal, Replicate, WaveSpeedAI, Apiframe (100 créditos), Hugging Face
(US$ 0,10/mês de crédito compartilhado), ModelScope. Nenhuma delas é plano
gratuito contínuo.

### O que a busca derrubou

- **Hugging Face não é rota gratuita de vídeo.** O free tier virou **US$ 0,10 por
  mês** de crédito, gasto no preço do parceiro. Vídeo é a categoria mais cara da
  tabela — dá para *testar*, não para operar ([Klymentiev](https://klymentiev.com/blog/huggingface-inference-api)).
- **SiliconFlow não tem vídeo grátis.** A lista de modelos marcados `免费` em
  21/08/2026 inclui chat, OCR, embedding e imagem — *"Neither listed Wan video
  model was free"* ([GetModelKey](https://www.getmodelkey.com/guides/silicon-flow-models-and-pricing/)).
- **Wan 2.5+ não é baixável.** Da 2.5 em diante só via API hospedada; os pesos
  param na 2.2 ([Apiframe](https://apiframe.ai/blog/free-ai-video-generation-api-2026)).
- **OpenAI encerrou a Videos API / Sora 2 em 24/09/2026** sem substituto — não é
  base para construir ([Apiframe](https://apiframe.ai/blog/free-ai-video-generation-api-2026)).

---

## 3. Como selecionei

Critérios, em ordem de peso — nenhum deles é "qualidade no demo":

| Peso | Critério | Por quê |
|---|---|---|
| 1 | Licença comercial clara | o vídeo vai dentro de treinamento vendido a empresa |
| 2 | Custo marginal ~zero | são 3–8 cenas por aula, milhares de aulas |
| 3 | Aderência ao prompt | precisamos de *cena específica* (recepção, EPI, notebook), não de arte |
| 4 | Piso de VRAM | define o preço/hora da GPU |
| 5 | Velocidade | aula precisa ficar pronta em minutos, não horas |
| 6 | Duração e resolução | 5–10 s a 720p bastam; o texto vai em HTML, não no vídeo |

Um detalhe de produto que muda a decisão: **o texto da aula não vai dentro do
vídeo**. Título, narração e legendas são HTML sobreposto pelo player. Então o
modelo não precisa renderizar letra legível nem fazer lip-sync — precisa acertar
a *cena*. Isso valoriza aderência a prompt e desvaloriza "cinema".

---

## 4. Os 3 escolhidos

### 🥇 Wan 2.2 — o padrão

**Apache 2.0** e roda a partir de **8 GB** de VRAM na variante 5B GGUF
([Thunder Compute](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models);
o card `Wan-AI/Wan2.2-TI2V-5B` no [ModelScope](https://modelscope.cn/models/Wan-AI/Wan2.2-TI2V-5B)
declara `license: apache-2.0`).

É o único da lista que junta três coisas: licença sem letra miúda, hardware de
consumidor e presença em **todas** as hospedagens relevantes. Na prática:

- começa hoje com créditos de fal/Replicate, sem comprar GPU;
- migra para self-host depois sem trocar prompt nem código;
- 720p é exatamente o que o card do player usa.

**Risco:** não gera áudio. A narração continua no `speechSynthesis` do player —
que, aliás, já funciona.

---

### 🥈 LTX-2.3 — o que resolve áudio

Único modelo aberto com **áudio sincronizado no mesmo passo de difusão**, 4K e
até 20 s ([Thunder Compute](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models)).

Para nós isso não é enfeite: hoje a aula é imagem + voz sintetizada pelo
navegador. Com LTX-2.3 a cena pode sair com ambiente e fala dentro do MP4, o que
(a) tira a dependência de voz do dispositivo — que varia de qualidade — e (b)
deixa o vídeo exportável/offline.

Licença: **grátis até US$ 10M de receita anual**; acima disso exige licença
comercial. A Pontufy, hoje, está muito abaixo do teto — mas o limite precisa
estar escrito no contrato do produto, porque essa é a linha que vira custo se a
empresa crescer.

**Custo:** piso de 16 GB (variante distilled) até 80 GB no BF16. É o mais caro
dos três em infra.

---

### 🥉 CogVideoX-2B — a rede de segurança

**Apache 2.0**, 16 GB, e a melhor aderência a prompt entre os abertos: a
arquitetura processa texto e visual no mesmo espaço, o que importa quando o
pedido é "três pessoas numa sala de reunião, luz fria, quadro branco ao fundo"
([Thunder Compute](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models)).

A função dele na arquitetura é ser o **fallback sem risco jurídico**: se a
licença do LTX-2.3 aperta, ou o Wan 2.2 não estiver disponível na hospedagem,
CogVideoX-2B entrega cena correta com licença Apache.

**Limite:** 6 s por clipe e qualidade abaixo dos dois primeiros. É por isso que
não é o primeiro.

---

## 5. Por que não os outros

| Modelo | Motivo da recusa |
|---|---|
| **HunyuanVideo 1.5** | Melhor movimento/cinema e roda em 14 GB — seria o 4º. Fica de fora porque a Tencent Community License tem condições próprias e o fine-tuning é limitado. **Se o critério virar realismo, ele substitui o CogVideoX-2B.** |
| CogVideoX-5B | Licença CogVideoX (restritiva) para ganho de qualidade que não usamos |
| Mochi 1 | Apache 2.0, mas teto de **480p** — abaixo do card do player |
| Stable Video Diffusion | Não é texto→vídeo (só imagem→vídeo) e a Stability Community exige licença para uso comercial |
| SkyReels V2 | Licença `other`, sem permissão comercial clara — não passa no critério 1 |
| Open-Sora 2.0 | Licença não confirmada na busca; não se escolhe o que não se verificou |

---

## 6. O que já está implementado

O transporte existe e é testado; o que falta é a chave.

- `domain/ai/video-providers.ts` — registro dos 4 presets (licença, VRAM, duração,
  áudio) + tradução de request/response de três transportes: `fal`, `replicate`
  e `generic` (submit → consulta → resultado).
- `domain/ai/video-engine.ts` — `submitRender` / `pollRender` / `renderVideo`
  com teto de tempo, backoff de 3 s a 15 s e **nunca lança**: sem provedor,
  devolve `not-configured` e a aula segue com o roteiro narrado.
- `LessonKit.video.videoUrl` — quando o render termina, o player usa `<video>`;
  sem URL, executa as cenas. Mesmo kit, com ou sem mídia.
- 9 testes de unidade travando o contrato: corpo por transporte, cabeçalho de
  auth, extração de job id, extração de URL nos 4 formatos, normalização de
  status e o caminho "sem configuração".

Para ligar, basta preencher um slot:

```bash
VIDEO_1_PROVIDER=wan-2.2
VIDEO_1_TRANSPORT=fal
VIDEO_1_BASE_URL=https://queue.fal.run
VIDEO_1_MODEL=fal-ai/wan-22/text-to-video
VIDEO_1_API_KEY=...
VIDEO_1_MAX_SECONDS=10
```

O transporte segue o padrão de fila documentado pelo
[fal](https://fal.ai/docs/documentation/model-apis/inference/queue): submete,
consulta o status, busca o resultado.

## 7. Custo honesto

Nenhum dos três é grátis de operar. O que é grátis é **a licença**:

| Caminho | Custo aproximado | Quando faz sentido |
|---|---|---|
| Self-host Wan 2.2 5B | GPU de 24 GB a ~US$ 0,35/h; ~5 min por clipe de 5 s 480p ⇒ **~US$ 0,02–0,03 por clipe** | volume alto, centenas de aulas |
| Hospedagem com créditos | centavos por clipe até o crédito acabar | validar, primeiras aulas |
| LTX-2.3 self-host | exige 16–32 GB; muito mais caro por hora | quando o áudio nativo valer a pena |

Referência de GPU: [Thunder Compute](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models).

---

## Fontes

- [Best Open-Source AI Video Generation Models (2026) — Thunder Compute](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models)
- [Free AI Video Generation API: What's Actually Free in 2026 — Apiframe](https://apiframe.ai/blog/free-ai-video-generation-api-2026)
- [Hugging Face Inference API Free Tier 2026 — Dmytro Klymentiev](https://klymentiev.com/blog/huggingface-inference-api)
- [SiliconFlow Free Models 2026 — Get Model Key](https://www.getmodelkey.com/guides/silicon-flow-models-and-pricing/)
- [Wan2.2-TI2V-5B (license: apache-2.0) — ModelScope](https://modelscope.cn/models/Wan-AI/Wan2.2-TI2V-5B)
- [SkyReels V2 (license: other) — Hugging Face](https://huggingface.co/Skywork/SkyReels-V2-I2V-1.3B-540P)
- [Queue API — fal](https://fal.ai/docs/documentation/model-apis/inference/queue)
