# Motor de cursos — pipeline multi-formato

Como um curso sai do prompt do RH e chega ao colaborador em quatro formatos.

```
prompt + setor (+ material de referência)
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ FASE 1 · Curso        course-engine.ts                       │
│ 1 chamada  → título, descrição, 3–8 aulas em markdown,       │
│              6–12 questões com dificuldade                   │
│ fallback   → template local determinístico                    │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ FASE 2 · Kits         lesson-kit-engine.ts                   │
│ N chamadas (1 por aula, concorrência 2, orçamento 75 s)      │
│  por aula → roteiro de vídeo (cenas), slides, resumo em      │
│             linguagem simples, 2–3 questões de fixação       │
│ fallback   → deriveKitFromMarkdown (sem IA)                   │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ PERSISTÊNCIA          actions/course-generator.ts            │
│ Course.quizJson  ← banco de questões com id + dificuldade     │
│ Lesson.blocks    ← kit da aula (JSON)                        │
│ Lesson.contentUrl← markdown completo                          │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ CONSUMO               player/[id] + LessonKitView            │
│ Vídeo: roteiro narrado por speechSynthesis                    │
│ Slides: deck navegável por teclado                            │
│ Leitura fácil: resumo com Flesch medido                       │
│ Quiz final: sorteio por semente, corrigido no servidor        │
└──────────────────────────────────────────────────────────────┘
```

## Por que duas fases

Uma chamada única gerando markdown + roteiro + slides + resumo + questões de 8
aulas estoura o teto de tokens do provedor. O sintoma desse estouro não é "erro
de token" — é JSON truncado, que aparece como "o modelo não soube responder".
Separar resolve três coisas de uma vez: cada chamada cabe no orçamento, a falha
de uma aula não derruba o curso, e o paralelismo reduz o tempo total.

## Contratos

| Arquivo | Papel |
|---|---|
| `schemas/course-schema.ts` | contrato do curso (markdown + quiz) |
| `schemas/lesson-kit.ts` | contrato do kit + leitura tolerante (`readLessonKit`) |
| `schemas/quiz.ts` | questão persistida (`id`, `difficulty`, `options[{text}]`) |
| `domain/learning/lesson-kit.ts` | `deriveKitFromMarkdown`, `normalizeKit`, `kitMetrics` |
| `domain/learning/readability.ts` | Flesch pt-BR, simplificação determinística |
| `domain/learning/quiz-selection.ts` | sorteio por semente e correção |

## Regras que o código impõe (e o prompt não consegue)

1. **Nada de aula quebrada.** `normalizeKit` valida campo a campo e completa o
   que faltar com a derivação. Slide sem marcador, cena sem narração e questão
   com `correctIndex` inválido são descartados — não propagados.
2. **Legibilidade é medida.** `makePlainLanguage` roda sobre todo resumo, com
   escada de tetos de 16 a 10 palavras por frase, e devolve a melhor versão.
   O número aparece no painel de geração (`fleschAvg`).
3. **Gabarito não sai do servidor.** `GET /api/courses/[id]/quiz` devolve
   pergunta e alternativas; a correção recompõe o sorteio a partir da semente.
4. **Curso antigo não fica de fora.** `Lesson.blocks` nulo → o player deriva o
   kit do markdown. Nenhum backfill foi necessário.

## Custos e limites

| Variável | Padrão | Efeito |
|---|---|---|
| `COURSE_MAX_OUTPUT_TOKENS` | 8192 | teto da fase 1 e fallback por provedor |
| `AI_n_MAX_TOKENS` | herdado | teto por provedor |
| `COURSE_KIT_BUDGET_MS` | 75000 | orçamento da fase 2; estourou, o resto é derivado |
| `COURSE_KIT_CONCURRENCY` | 2 | chamadas simultâneas na fase 2 |
| `COURSE_KIT_GENERATION` | ligado | `off` força derivação (útil para economizar cota) |

## Bancada

```bash
npx tsx scripts/test-lesson-kit.mjs        # motor real, 2 aulas sintéticas
npx tsx scripts/test-lesson-kit.mjs --off  # só derivação (sem rede)
```

Sai, por aula: quem respondeu, slides, cenas, segundos de vídeo, questões de
fixação e Flesch do resumo. É o teste que responde "o motor ainda entrega os
quatro formatos?" sem abrir a interface.
