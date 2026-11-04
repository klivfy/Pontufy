// ═══════════════════════════════════════════════════════════════════════
// Pontufy — Inicialização segura e resiliente dos provedores de IA
// ═══════════════════════════════════════════════════════════════════════
// Cadeia de fallback multi-provedor (custo-benefício):
//   1. Google Gemini (gemini-2.0-flash / gemini-1.5-flash)
//   2. OpenAI (gpt-4o-mini)
//   3. Anthropic (claude-3-5-haiku / claude-3-haiku)
//   4. Template local determinístico (último recurso, sem rede)
//
// Convenções Vercel AI SDK v6:
//   - maxOutputTokens (NUNCA maxTokens — obsoleto/quebrado no v6)
//   - toTextStreamResponse() para streams (NUNCA toDataStreamResponse)
// ═══════════════════════════════════════════════════════════════════════

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

// ─────────────────────── Verificação de chave ───────────────────────

/**
 * Gemini API Studio keys sempre começam com "AIza".
 * Tokens OAuth (prefixo "AQ.") não são aceitos pelo endpoint REST.
 */
const GEMINI_APIKEY_RE = /^AIza/;

function isValidGeminiKey(key: string): boolean {
  return GEMINI_APIKEY_RE.test(key);
}

// ──────────────────── Cadeia de provedores (cascade) ────────────────

export type StructuredMode = 'auto' | 'schema' | 'json';

export interface ProviderAttempt {
  name: string;
  /** Rótulo amigável exibido na UI (sem expor chaves). */
  label: string;
  /**
   * Como o provedor lida com saída estruturada:
   *  - `schema`: honra `response_format: json_schema` (Groq, OpenAI).
   *  - `json`:   ignora `json_schema` e devolve JSON livre (Ollama Cloud,
   *              vários modelos `:free`). Pula a 1ª tentativa e vai direto ao
   *              modo JSON, economizando uma chamada perdida.
   *  - `auto`:   tenta `schema` e recupera em modo JSON ao falhar.
   */
  structured: StructuredMode;
  /** Prazo da tentativa. Estourou, passa para o próximo provedor. */
  timeoutMs: number;
  /** Teto de tokens de saída deste provedor (nem todo modelo aceita o mesmo). */
  maxOutputTokens: number;
  build: () => LanguageModel;
}

// ─────────────── Provedores compatíveis com OpenAI (testes) ───────────────

export interface CompatProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
  structured: StructuredMode;
  timeoutMs: number;
  maxOutputTokens: number;
}

/** Quantos slots numerados são lidos (`AI_1_*` … `AI_10_*`). */
const MAX_COMPAT_SLOTS = 10;
const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Teto de saída padrão. Modelos de raciocínio (gpt-oss) consomem o orçamento
 * em `reasoning` e truncam o JSON; um provedor com teto menor (Groq) recusa ou
 * trunca acima do limite. Por isso o valor é POR PROVEDOR:
 * `AI_n_MAX_TOKENS` > `COURSE_MAX_OUTPUT_TOKENS` > 8192.
 */
function defaultMaxOutputTokens(): number {
  const value = Number(process.env.COURSE_MAX_OUTPUT_TOKENS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 8192;
}

function parseStructured(raw: string | undefined): StructuredMode {
  const value = raw?.trim().toLowerCase();
  return value === 'schema' || value === 'json' || value === 'auto' ? value : 'auto';
}

function parseTimeout(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TIMEOUT_MS;
}

function parseMaxTokens(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultMaxOutputTokens();
}

interface RawCompatFields {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  label?: string;
  structured?: string;
  timeoutMs?: string;
  maxTokens?: string;
}

/** Valida e normaliza um conjunto de campos; `null` quando incompleto/ inválido. */
function buildCompatConfig(raw: RawCompatFields, slot: string): CompatProviderConfig | null {
  const baseUrl = raw.baseUrl?.trim();
  const apiKey = raw.apiKey?.trim();
  const model = raw.model?.trim();

  // Configuração parcial é erro de operação, não motivo para seguir calado:
  // sem o aviso, o sintoma seria "a IA não usa o provedor que eu configurei".
  if (!baseUrl && !apiKey && !model) return null;
  if (!baseUrl || !apiKey || !model) {
    console.warn(
      `[ai-providers] Slot ${slot} ignorado: defina ${slot === 'legacy' ? 'AI_BASE_URL, AI_API_KEY e AI_MODEL' : `${slot}_BASE_URL, ${slot}_API_KEY e ${slot}_MODEL`} juntos.`,
    );
    return null;
  }

  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    console.warn(`[ai-providers] ${slot}: URL inválida ("${baseUrl.slice(0, 32)}…") — ignorada.`);
    return null;
  }

  // Chave de provedor gratuito em produção = material de RH saindo para um
  // terceiro cujo plano pode treinar com os dados. Não bloqueia (é escolha
  // consciente), mas o log precisa ser impossível de ignorar.
  if (process.env.NODE_ENV === 'production' && process.env.AI_ALLOW_COMPAT_IN_PRODUCTION !== '1') {
    console.warn(
      `[ai-providers] ⚠️ Provedor compatível ATIVO EM PRODUÇÃO (${host}). ` +
        'Confirme a política de dados do provedor: planos gratuitos costumam usar o conteúdo para treino. ' +
        'Defina AI_ALLOW_COMPAT_IN_PRODUCTION=1 para silenciar este aviso.',
    );
  }

  return {
    baseUrl,
    apiKey,
    model,
    label: raw.label?.trim() || host,
    structured: parseStructured(raw.structured),
    timeoutMs: parseTimeout(raw.timeoutMs),
    maxOutputTokens: parseMaxTokens(raw.maxTokens),
  };
}

/**
 * Provedores configurados por slots numerados, na ordem de prioridade.
 *
 *   AI_1_LABEL=Groq
 *   AI_1_BASE_URL=https://api.groq.com/openai/v1
 *   AI_1_MODEL=openai/gpt-oss-120b
 *   AI_1_API_KEY=...
 *   AI_1_STRUCTURED=schema      # schema | json | auto
 *   AI_1_TIMEOUT_MS=45000
 *
 * Compatibilidade: se nenhum slot numerado existir, aceita o formato antigo
 * (`AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`/`AI_LABEL`) como provedor único.
 */
export function readCompatProviders(): CompatProviderConfig[] {
  const providers: CompatProviderConfig[] = [];

  for (let i = 1; i <= MAX_COMPAT_SLOTS; i++) {
    const slot = `AI_${i}`;
    const config = buildCompatConfig(
      {
        baseUrl: process.env[`${slot}_BASE_URL`],
        apiKey: process.env[`${slot}_API_KEY`],
        model: process.env[`${slot}_MODEL`],
        label: process.env[`${slot}_LABEL`],
        structured: process.env[`${slot}_STRUCTURED`],
        timeoutMs: process.env[`${slot}_TIMEOUT_MS`],
        maxTokens: process.env[`${slot}_MAX_TOKENS`],
      },
      slot,
    );
    if (config) providers.push(config);
  }

  if (providers.length > 0) return providers;

  const legacy = buildCompatConfig(
    {
      baseUrl: process.env.AI_BASE_URL,
      apiKey: process.env.AI_API_KEY,
      model: process.env.AI_MODEL,
      label: process.env.AI_LABEL,
      structured: process.env.AI_STRUCTURED,
      timeoutMs: process.env.AI_TIMEOUT_MS,
      maxTokens: process.env.AI_MAX_TOKENS,
    },
    'legacy',
  );

  return legacy ? [legacy] : [];
}

/**
 * Constrói a cadeia de fallback na ordem estrita de prioridade:
 * provedores compatíveis (na ordem dos slots) → Gemini → OpenAI → Anthropic.
 * Provedores sem chave válida são pulados.
 */
export function buildProviderChain(): ProviderAttempt[] {
  const chain: ProviderAttempt[] = [];

  for (const compat of readCompatProviders()) {
    const provider = createOpenAI({
      apiKey: compat.apiKey,
      baseURL: compat.baseUrl,
      name: compat.label,
    });
    chain.push({
      name: `compat:${compat.model}`,
      label: `${compat.label} (${compat.model})`,
      structured: compat.structured,
      timeoutMs: compat.timeoutMs,
      maxOutputTokens: compat.maxOutputTokens,
      // `.chat()` resolve para POST /chat/completions — o único endpoint que
      // Groq, OpenRouter, GitHub Models, Cerebras, Mistral e Ollama expõem.
      // `openai(model)` apontaria para a Responses API, exclusiva da OpenAI.
      build: () => provider.chat(compat.model),
    });
  }

  const googleKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (googleKey && isValidGeminiKey(googleKey)) {
    const google = createGoogleGenerativeAI({ apiKey: googleKey });
    const model = process.env.GOOGLE_COURSE_MODEL || 'gemini-2.0-flash';
    chain.push({
      name: `google:${model}`,
      label: `Google Gemini (${model})`,
      structured: 'schema',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxOutputTokens: defaultMaxOutputTokens(),
      build: () => google(model),
    });
  } else if (googleKey) {
    console.warn(
      `[ai-providers] GEMINI_API_KEY com formato inválido ("${googleKey.slice(0, 6)}…") — ignorada.`,
    );
  }

  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_COURSE_MODEL || 'gpt-4o-mini';
    chain.push({
      name: `openai:${model}`,
      label: `OpenAI (${model})`,
      structured: 'schema',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxOutputTokens: defaultMaxOutputTokens(),
      build: () => openai(model),
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.ANTHROPIC_COURSE_MODEL || 'claude-3-5-haiku';
    chain.push({
      name: `anthropic:${model}`,
      label: `Anthropic (${model})`,
      structured: 'schema',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxOutputTokens: defaultMaxOutputTokens(),
      build: () => anthropic(model),
    });
  }

  return chain;
}

// ───────────────────────── Diagnóstico de provedores ────────────────

export interface ProviderDiagnostics {
  available: string[];
  configured: boolean;
  diagnostics: Record<string, string>;
  chainOrder: string[];
}

/**
 * Diagnóstico completo dos provedores para /api/admin/ai-status e UI.
 * Nunca expõe as chaves — apenas prefixo curto do formato.
 */
export async function checkAIProviders(): Promise<ProviderDiagnostics> {
  const available: string[] = [];
  const diagnostics: Record<string, string> = {};

  const compatProviders = readCompatProviders();
  if (compatProviders.length > 0) {
    compatProviders.forEach((provider, index) => {
      const host = new URL(provider.baseUrl).host;
      available.push(`Compatível (${provider.label})`);
      diagnostics[`compat_${index + 1}`] =
        `Configurado — ${provider.model} via ${host} | structured=${provider.structured} | timeout=${provider.timeoutMs}ms`;
    });
  } else {
    diagnostics.compat = 'Nenhum provedor compatível configurado (AI_1_* … AI_10_* ou AI_BASE_URL)';
  }

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (geminiKey && isValidGeminiKey(geminiKey)) {
    available.push('Google Gemini');
    diagnostics.gemini = `Configurado (${geminiKey.slice(0, 6)}…)`;
  } else if (geminiKey) {
    diagnostics.gemini = 'Chave inválida — deve começar com "AIza" (formato "AIza…")';
  } else {
    diagnostics.gemini = 'GEMINI_API_KEY não encontrada no ambiente';
  }

  if (process.env.OPENAI_API_KEY) {
    available.push('OpenAI');
    diagnostics.openai = 'Configurado';
  } else {
    diagnostics.openai = 'OPENAI_API_KEY não encontrada';
  }

  if (process.env.ANTHROPIC_API_KEY) {
    available.push('Anthropic Claude');
    diagnostics.anthropic = 'Configurado';
  } else {
    diagnostics.anthropic = 'ANTHROPIC_API_KEY não encontrada';
  }

  return {
    available,
    configured: available.length > 0,
    diagnostics,
    chainOrder: buildProviderChain().map((p) => p.name),
  };
}
