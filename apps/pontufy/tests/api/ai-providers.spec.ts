import { test, expect } from '@playwright/test';
import { buildProviderChain, checkAIProviders } from '../../src/lib/ai-providers';

// ═══════════════════════════════════════════════════════════════════════════
// Cadeia de provedores de IA — contrato puro, sem rede e sem banco.
//
// A escolha do provedor é invisível em execução: se um slot for ignorado por
// engano, o sintoma é "a geração caiu no template local". Aqui a ordem, o modo
// de structured output e o orçamento de tokens de cada provedor são verificados.
// ═══════════════════════════════════════════════════════════════════════════

const SLOT_FIELDS = ['BASE_URL', 'API_KEY', 'MODEL', 'LABEL', 'STRUCTURED', 'TIMEOUT_MS', 'MAX_TOKENS'];
const LEGACY_FIELDS = ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_LABEL', 'AI_STRUCTURED', 'AI_TIMEOUT_MS'];
const NATIVE = ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];

const MANAGED = [
  ...LEGACY_FIELDS,
  ...NATIVE,
  ...Array.from({ length: 10 }, (_, i) => SLOT_FIELDS.map((f) => `AI_${i + 1}_${f}`)).flat(),
  'COURSE_MAX_OUTPUT_TOKENS',
];

let saved: Record<string, string | undefined>;

test.beforeEach(() => {
  saved = {};
  for (const key of MANAGED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

test.afterEach(() => {
  for (const key of MANAGED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function configureSlot(slot: number, config: { baseUrl: string; model: string; structured?: string; maxTokens?: string }): void {
  process.env[`AI_${slot}_BASE_URL`] = config.baseUrl;
  process.env[`AI_${slot}_API_KEY`] = 'test-key-not-real';
  process.env[`AI_${slot}_MODEL`] = config.model;
  if (config.structured) process.env[`AI_${slot}_STRUCTURED`] = config.structured;
  if (config.maxTokens) process.env[`AI_${slot}_MAX_TOKENS`] = config.maxTokens;
}

test.describe('cadeia de provedores de IA', () => {
  test('sem nenhuma chave a cadeia é vazia (o gerador cai no template local)', () => {
    expect(buildProviderChain()).toHaveLength(0);
  });

  test('slots numerados entram na cadeia na ordem 1, 2, 3', () => {
    configureSlot(1, { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', structured: 'schema' });
    configureSlot(2, { baseUrl: 'https://ollama.com/v1', model: 'gpt-oss:120b', structured: 'json' });
    configureSlot(3, { baseUrl: 'https://openrouter.ai/api/v1', model: 'dots-studio/dots-3-note-preview:free' });

    const chain = buildProviderChain();
    expect(chain.map((p) => p.name)).toEqual([
      'compat:openai/gpt-oss-120b',
      'compat:gpt-oss:120b',
      'compat:dots-studio/dots-3-note-preview:free',
    ]);
    // O modo declarado é respeitado: Ollama Cloud sabidamente ignora json_schema.
    expect(chain.map((p) => p.structured)).toEqual(['schema', 'json', 'auto']);
  });

  test('orçamento de tokens é por provedor (Groq menor, raciocínio maior)', () => {
    process.env.COURSE_MAX_OUTPUT_TOKENS = '8192';
    configureSlot(1, { baseUrl: 'https://api.groq.com/openai/v1', model: 'a', maxTokens: '8192' });
    configureSlot(2, { baseUrl: 'https://ollama.com/v1', model: 'b', maxTokens: '24000' });
    configureSlot(3, { baseUrl: 'https://openrouter.ai/api/v1', model: 'c' }); // herda o global

    const budgets = buildProviderChain().map((p) => p.maxOutputTokens);
    expect(budgets).toEqual([8192, 24000, 8192]);
  });

  test('timeout padrão é aplicado e pode ser sobrescrito por slot', () => {
    configureSlot(1, { baseUrl: 'https://api.groq.com/openai/v1', model: 'a' });
    process.env.AI_1_TIMEOUT_MS = '5000';
    configureSlot(2, { baseUrl: 'https://ollama.com/v1', model: 'b' });

    const timeouts = buildProviderChain().map((p) => p.timeoutMs);
    expect(timeouts[0]).toBe(5000);
    expect(timeouts[1]).toBe(90_000);
  });

  test('configuração parcial de um slot é ignorada sem derrubar os demais', () => {
    configureSlot(1, { baseUrl: 'https://api.groq.com/openai/v1', model: 'ok' });
    process.env.AI_2_BASE_URL = 'https://ollama.com/v1'; // sem key/model

    expect(buildProviderChain().map((p) => p.name)).toEqual(['compat:ok']);
  });

  test('URL malformada é ignorada em vez de derrubar a geração', () => {
    configureSlot(1, { baseUrl: 'nao-e-uma-url', model: 'x' });
    expect(buildProviderChain()).toHaveLength(0);
  });

  test('formato antigo (AI_BASE_URL) continua funcionando como provedor único', () => {
    process.env.AI_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.AI_API_KEY = 'ollama';
    process.env.AI_MODEL = 'llama3.2';

    const chain = buildProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe('compat:llama3.2');
  });

  test('chave Gemini fora do formato AIza é descartada (token OAuth não serve)', () => {
    process.env.GEMINI_API_KEY = 'AQ.tokenOAuthQueNaoFuncionaNoEndpoint';
    expect(buildProviderChain().some((p) => p.name.startsWith('google:'))).toBe(false);
  });

  test('ordem final: compatíveis numerados → Gemini → OpenAI → Anthropic', () => {
    configureSlot(1, { baseUrl: 'https://api.groq.com/openai/v1', model: 'a' });
    configureSlot(2, { baseUrl: 'https://ollama.com/v1', model: 'b' });
    process.env.GEMINI_API_KEY = 'AIzaChaveDeTeste0000000000000000000000';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    const names = buildProviderChain().map((p) => p.name.split(':')[0]);
    expect(names).toEqual(['compat', 'compat', 'google', 'openai', 'anthropic']);
  });

  test('diagnóstico lista cada provedor compatível sem expor a chave', async () => {
    configureSlot(1, { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', structured: 'schema' });
    configureSlot(2, { baseUrl: 'https://ollama.com/v1', model: 'gpt-oss:120b', structured: 'json' });

    const diag = await checkAIProviders();
    expect(diag.diagnostics.compat_1).toContain('openai/gpt-oss-120b');
    expect(diag.diagnostics.compat_1).toContain('structured=schema');
    expect(diag.diagnostics.compat_2).toContain('structured=json');
    expect(JSON.stringify(diag)).not.toContain('test-key-not-real');
  });
});
