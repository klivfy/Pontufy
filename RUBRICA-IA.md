# Rubrica de avaliação — cursos gerados por IA

**Definida antes da primeira execução** (03/11/2026), para que o julgamento seja auditável. Aplicada por [`scripts/eval-courses.mjs`](apps/pontufy/scripts/eval-courses.mjs), que calcula os critérios automáticos e deixa o julgamento qualitativo explicitamente separado.

---

## Critérios automáticos (bloqueantes)

Um curso só é **aprovado** se passar em todos. Todos são medidos pela máquina.

| # | Critério | Regra | Por que |
|---|---|---|---|
| A1 | Schema válido | passa em `generatedCourseSchema` | contrato consumido pela persistência |
| A2 | Volume de aulas | ≥ 3 aulas | exigência do schema; menos que isso é curso raso |
| A3 | Extensão por aula | média ≥ 700 caracteres **e** nenhuma aula < 400 | abaixo disso é bullet point, não aula |
| A4 | Quiz consistente | ≥ 2 questões, `correctIndex` dentro das opções, ≥ 3 opções, sem opções duplicadas | questão inválida invalida a avaliação |
| A5 | Sem repetição | títulos de aula distintos entre si | sintoma clássico de modelo que "enrola" |
| A6 | Idioma | ≥ 97% das palavras do conteúdo são latinas (pt-BR); nenhuma frase com 3+ stopwords inglesas seguidas | curso em inglês num produto em português é defeito |
| A7 | Aderência ao material | ≥ 40% dos termos-chave do material de referência aparecem no curso | prova que o modelo **leu** o material |
| A8 | Origem | `usedFallback: false` | template local não conta como geração por IA |

## Critérios qualitativos (não bloqueantes, avaliados a olho)

Registrados como observação, nunca como nota — para não maquiar julgamento subjetivo de número:

- Q1 · Progressão didática: a aula 1 introduz, a última conclui?
- Q2 · Quiz mede compreensão, ou só decoração?
- Q3 · O conteúdo cita o material ou apenas o parafraseia vagamente?
- Q4 · Há afirmação factualmente arriscada (prazo, lei, valor) sem base no material?

## Como os números são calculados

- **A3** — média e mínimo de `lesson.content.length`.
- **A6** — proporção de caracteres em faixa latina (`À-ÿ` e ASCII); stopwords inglesas: `the, and, with, your, from, this, that, are, was, have, will, should`.
- **A7** — termos do material: palavras ≥ 5 letras, minúsculas, sem stopwords pt, deduplicadas. Aderência = termos presentes no texto do curso / total.
- **A8** — `meta.usedFallback` da resposta do motor.

## O que a rubrica **não** mede

- Correção jurídica ou técnica do conteúdo (exige especialista).
- Adequação pedagógica ao público específico.
- Custo por curso em produção (aqui só tokens de uma execução).

Essas três ficam registradas como lacuna conhecida — e são o motivo de o IA-3 ser um **relatório de comparação**, não um certificado de qualidade.
