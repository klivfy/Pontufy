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

export interface ProviderAttempt {
  name: string;
  /** Rótulo amigável exibido na UI (sem expor chaves). */
  label: string;
  build: () => LanguageModel;
}

// ─────────────── Provedor compatível com OpenAI (testes) ───────────────

interface CompatProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

/**
 * Provedor genérico compatível com `POST /chat/completions`.
 *
 * Existe para testar o motor de geração de cursos com APIs gratuitas sem
 * adicionar SDK: Groq, OpenRouter, GitHub Models, Cerebras, Mistral e Ollama
 * expõem o mesmo contrato do OpenAI. Configuração por `AI_BASE_URL`,
 * `AI_API_KEY`, `AI_MODEL` e (opcional) `AI_LABEL`.
 */
function readCompatProvider(): CompatProviderConfig | null {
  const baseUrl = process.env.AI_BASE_URL?.trim();
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_MODEL?.trim();

  // Configuração parcial é erro de operação, não motivo para seguir calado:
  // sem o aviso, o sintoma seria "a IA não usa o provedor que eu configurei".
  if (!baseUrl && !apiKey && !model) return null;
  if (!baseUrl || !apiKey || !model) {
    console.warn(
      '[ai-providers] Provedor compatível ignorado: defina AI_BASE_URL, AI_API_KEY e AI_MODEL juntos.',
    );
    return null;
  }

  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    console.warn(`[ai-providers] AI_BASE_URL inválida ("${baseUrl.slice(0, 32)}…") — ignorada.`);
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
    label: process.env.AI_LABEL?.trim() || host,
  };
}

/**
 * Constrói a cadeia de fallback na ordem estrita de prioridade:
 * compatível (quando configurado) → Gemini → OpenAI → Anthropic.
 * Provedores sem chave válida são pulados.
 */
export function buildProviderChain(): ProviderAttempt[] {
  const chain: ProviderAttempt[] = [];

  const compat = readCompatProvider();
  if (compat) {
    const provider = createOpenAI({
      apiKey: compat.apiKey,
      baseURL: compat.baseUrl,
      name: compat.label,
    });
    chain.push({
      name: `compat:${compat.model}`,
      label: `${compat.label} (${compat.model})`,
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
    chain.push({ name: `google:${model}`, label: `Google Gemini (${model})`, build: () => google(model) });
  } else if (googleKey) {
    console.warn(
      `[ai-providers] GEMINI_API_KEY com formato inválido ("${googleKey.slice(0, 6)}…") — ignorada.`,
    );
  }

  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_COURSE_MODEL || 'gpt-4o-mini';
    chain.push({ name: `openai:${model}`, label: `OpenAI (${model})`, build: () => openai(model) });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.ANTHROPIC_COURSE_MODEL || 'claude-3-5-haiku';
    chain.push({ name: `anthropic:${model}`, label: `Anthropic (${model})`, build: () => anthropic(model) });
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

  const compat = readCompatProvider();
  if (compat) {
    available.push(`Compatível (${compat.label})`);
    diagnostics.compat = `Configurado — ${compat.model} via ${new URL(compat.baseUrl).host}`;
  } else {
    diagnostics.compat = 'AI_BASE_URL / AI_API_KEY / AI_MODEL não configurados (opcional, para testes)';
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
