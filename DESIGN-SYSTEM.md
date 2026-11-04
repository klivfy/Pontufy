# Design System — Pontufy (Material Design 3)

Fonte única: `apps/pontufy/src/app/globals.css` (`@theme`). Nada de cor literal em
componente. Este documento explica **por que** cada token existe, para que a
próxima mudança não recrie a bagunça que ele resolveu.

## 1. Paleta

Dez cores de marca. Todo o resto é derivado delas por tom — nenhuma matiz nova
entra no produto.

| Cor | Token de origem | Papel M3 |
|---|---|---|
| `#495453` verde-chumbo | primary | ação principal, texto de marca |
| `#cad9ca` sálvia | primary-container | seleção, chip ativo, avatar |
| `#e0d2c5` areia | secondary-container | estado neutro/pendente, prêmio |
| `#a7e3c1` menta | tertiary-container | pontos, sucesso, gamificação |
| `#f5c8bf` blush | error-container / highlight | erro, atenção, raridade lendária |
| `#d4d4d4` | outline | traço de card, campo, divisor |
| `#acacac` | outline-variant | divisor discreto, trilha de progresso |
| `#848484` | — | estado desabilitado, placeholder |
| `#5c5c5c` | on-surface-variant | texto secundário |
| `#343434` | inverse-surface | scrim de mídia, tooltip, fundo escuro |

Superfícies claras (`surface`, `surface-container-*`) e as tintas `on-*` são
derivadas. O esquema é **claro** (`color-scheme: light`).

### Regras que não são estilo, são acessibilidade

1. **Texto sobre container tonal usa o par `on-*-container`.** `text-md-tertiary`
   sobre `bg-md-tertiary-container` dá 4,3:1 (reprova AA). `text-md-on-tertiary-container`
   dá 12:1.
2. **Nunca use alfa em token de texto.** `text-md-on-surface-variant/60` sobre
   papel claro cai para ~2,5:1. No tema escuro o mesmo alfa passava; no claro não.
   Se precisa de hierarquia, use `on-surface-variant` → `on-surface-muted` →
   `on-surface` (três degraus sólidos, todos ≥ 4,5:1).
3. **`bg-md-outline` é traço, não superfície.** Para chip neutro use
   `bg-md-surface-container-high`.

## 2. Tipografia

**Google Sans Flex**, variável (wght 1–1000, opsz 6–144), via `next/font/google`
— baixada no build e servida self-hosted. Declarada em `--font-sans`
(globals.css) e carregada em `layout.tsx`.

Escala M3 em utilities: `text-display-*`, `text-headline-*`, `text-title-*`,
`text-body-*`, `text-label-*`. Não invente tamanho com `text-[13px]` — use a
escala e, se faltar um degrau, adicione-o no `@theme`.

Mono (`--font-mono`, Geist Mono) só para hash de certificado e bloco de código.

## 3. Shape e elevação

`--radius-xs|sm|md|lg|xl` = 4 · 8 · 12 · 16 · 28 dp. Botões e chips são pill
(`rounded-full`). Card = `rounded-2xl` (16dp); herói de mídia = 28dp.

`--md-elevation-1..5` são as sombras canônicas (quentes, baixa opacidade).
Também existem como utilitário `.md-elevation-N`. **`hover:elevation` não existe**:
variante só funciona em utility do Tailwind, então use `hover:shadow-lg`.

## 4. Componentes base

| Classe | Uso |
|---|---|
| `.md-btn` + `.md-btn-filled\|tonal\|outlined\|text\|elevated\|error` | botão M3 (state layer em `::after`) |
| `.md-card-elevated\|outlined\|filled` | card |
| `.md-chip`, `.md-chip-selected` | chip/filtro |
| `.md-divider` | divisor |
| `.md-state-layer` | hover sutil em item de lista |

`<Button variant="destructive">` existe para ação irreversível — não sobrescreva
classe por fora (`!bg-*` era sintaxe do Tailwind v3 e não compila no v4).

## 5. Validação

O contraste é medido, não estimado: abra as rotas principais e percorra os nós de
texto comparando a cor efetiva com o fundo efetivo (compondo alfa e opacidade de
todos os ancestrais). O alvo é WCAG 2.1 AA (4,5:1 texto normal, 3:1 texto grande).
Controles desabilitados são isentos.

Ao adicionar tela nova, o teste mínimo é: renderizar em 1440px e 390px e conferir
que nenhum texto ficou abaixo de 4,5:1.
