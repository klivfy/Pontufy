# Execução IA-3 — avaliação de qualidade dos cursos gerados

**Data:** 03/11/2026 · **Rubrica:** [RUBRICA-IA.md](RUBRICA-IA.md) (definida antes da execução) · **Bancada:** `npm run eval:ai`
**Conteúdo:** sintético (nenhum material de cliente). **Nove gerações reais**, três por provedor.

---

## 1. Resultado automático (critérios A1–A8)

| Provedor | Cenário | Latência | Aulas | Média chars | Menor aula | Aderência | Veredito |
|---|---|---|---|---|---|---|---|
| **Groq** | lgpd | 6,5 s | 5 | 1.309 | 1.084 | 88% | ✅ |
| **Groq** | atendimento | 6,2 s | 4 | 1.445 | 1.347 | 95% | ✅ |
| **Groq** | infosec | 24,4 s | 4 | 1.946 | 1.756 | 97% | ✅ |
| **Ollama Cloud** | lgpd | 7,9 s | 4 | 1.453 | 1.296 | 96% | ✅ |
| **Ollama Cloud** | atendimento | 6,7 s | 5 | 1.121 | 979 | 95% | ✅ |
| **Ollama Cloud** | infosec | 13,0 s | 5 | 1.359 | 1.292 | 94% | ✅ |
| **OpenRouter** | lgpd | 70,6 s | 7 | 1.168 | 1.112 | 98% | ✅ |
| **OpenRouter** | atendimento | 149,0 s | 5 | 1.862 | 1.755 | 95% | ✅ |
| **OpenRouter** | infosec | 95,5 s | 5 | 1.378 | 1.282 | 86% | ✅ |

**9/9 aprovados pela rubrica automática.** Nenhum caiu no template local; nenhum reprovou em idioma, quiz, repetição ou volume.

## 2. Julgamento qualitativo (Q1–Q4) — e o que a rubrica **não** viu

Amostra revisada: curso de segurança da informação gerado pelo Groq.

**Q1 · Progressão didática — bom.** A sequência funciona: fundamentos e phishing → procedimento de reporte → senhas → MFA → boas práticas gerais. Cada aula retoma o anterior.

**Q2 · Quiz mede compreensão — bom.** As questões pedem aplicação ("qual a ação correta ao receber e-mail suspeito"), não decoreba. Distratores plausíveis, uma única resposta correta evidente.

**Q3 · Cita o material — bom.** Os números vieram do material, não de invenção: 14 caracteres, MFA em e-mail/VPN/financeiro, botão Report Phishing, verificação de URL passando o mouse.

**Q4 · Afirmação contrária ao material — ❌ ENCONTRADO.**

> Questão do quiz: *"Qual o procedimento ao conectar um pendrive desconhecido?"*
> Resposta marcada como correta: *"Escanear com antivírus antes de abrir qualquer arquivo"*
> O material de referência diz: *"Pendrives e mídias desconhecidas **nunca** devem ser conectados."*

O modelo não citou errado — **contrariou a política**. Um colaborador que respondesse conforme o material erraria a questão. A rubrica automática aprovou: o quiz é estruturalmente válido, o idioma está correto, a aderência é 97%.

**Este é o achado mais importante do IA-3:** nenhum critério automatizado detecta contradição semântica com a fonte.

## 3. Comparação de custo e latência

| Provedor | Latência média | Aulas médias | Aderência média |
|---|---|---|---|
| **Groq** | **12,4 s** (6–24 s) | 4,3 | 93% |
| **Ollama Cloud** | 9,2 s (6,7–13 s) | 4,7 | 95% |
| **OpenRouter** | **105 s** (71–149 s) | 5,7 | 93% |

O Ollama Cloud foi, nesta rodada, **mais rápido que o Groq** — o oposto da bancada anterior (14,2 s × 6,1 s). Latência de plano gratuito varia com a carga do momento; é argumento a favor do timeout por provedor, não de escolher um só.

O OpenRouter, com 71–149 s, está fora do envelope de uma função serverless síncrona. Serve como terceiro elo, nunca como principal.

## 4. Conclusões

1. **A qualidade é utilizável.** 9/9 aprovados, aulas de 1.000–1.900 caracteres, aderência média de 93% ao material.
2. **A qualidade não é confiável sem revisão humana.** O caso do pendrive mostra que uma política de segurança pode ser invertida com aparência perfeita.
3. **Groq e Ollama Cloud são equivalentes em qualidade**; a escolha entre eles é de latência e estabilidade do momento.
4. **OpenRouter não serve para geração síncrona.**

## 5. Lacuna aberta — critério A9

Proposta para o próximo ciclo: **detecção de contradição com o material**, em duas camadas:

- **A9a (barato):** extrair padrões normativos do material (`nunca`, `obrigatório`, `no mínimo`, `em até`) e verificar se o curso os repete sem negá-los. Pega o caso do pendrive.
- **A9b (caro):** LLM-as-judge com o material e o curso lado a lado, perguntando explicitamente "o curso contradiz alguma regra do material?". Detecta o que o A9a não pega, ao custo de mais uma chamada.

Até que A9 exista, o fluxo correto é: **geração por IA + revisão humana obrigatória antes de publicar**. Isso deve estar explícito na UI do `AIWizard` — hoje o RH recebe o curso como pronto.

## 6. Reprodução

```bash
cd apps/pontufy
npm run eval:ai                  # provedores 1 e 2, 3 cenários
npm run eval:ai -- --provider=3  # só o terceiro
npm run eval:ai -- --all         # todos
npx tsx scripts/sample-course.mjs  # amostra para revisão qualitativa
```

Relatório bruto: `test-results/ai-eval-report.json`.
