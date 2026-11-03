import { test, expect } from '@playwright/test';
import { buildProviderChain, checkAIProviders } from '../../src/lib/ai-providers';

// ═══════════════════════════════════════════════════════════════════════════
// Cadeia de provedores de IA — contrato puro, sem rede e sem banco.
//
// Estes testes existem porque a escolha do provedor é invisível em execução:
// se `AI_BASE_URL` for ignorada por engano, o sintoma é "a geração caiu no
// template local" e ninguém descobre o motivo. Aqui a ordem é verificada.
// ═══════════════════════════════════════════════════════════════════════════

const MANAGED = [
  'AI_BASE_URL',
  'AI_API_KEY',
  'AI_MODEL',
  'AI_LABEL',
  'GEMINI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
] as const;

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

test.describe('cadeia de provedores de IA', () => {
  test('sem nenhuma chave a cadeia é vazia (o gerador cai no template local)', () => {
    expect(buildProviderChain()).toHaveLength(0);
  });

  test('provedor compatível entra primeiro e usa /chat/completions', async () => {
    process.env.AI_BASE_URL = 'https://api.groq.com/openai/v1';
    process.env.AI_API_KEY = 'gsk_test_nao_e_uma_chave_real';
    process.env.AI_MODEL = 'llama-3.3-70b-versatile';
    process.env.GEMINI_API_KEY = 'AIzaChaveDeTeste0000000000000000000000';

    const chain = buildProviderChain();
    expect(chain[0].name).toBe('compat:llama-3.3-70b-versatile');
    expect(chain[0].label).toContain('api.groq.com');
    // O modelo é construído sob demanda — aqui só provamos que não lança.
    expect(chain[0].build()).toBeTruthy();

    // Gemini continua na cadeia como fallback.
    expect(chain.some((p) => p.name.startsWith('google:'))).toBe(true);

    const diag = await checkAIProviders();
    expect(diag.diagnostics.compat).toContain('llama-3.3-70b-versatile');
  });

  test('configuração parcial do provedor compatível é ignorada (não quebra a cadeia)', () => {
    process.env.AI_BASE_URL = 'https://api.groq.com/openai/v1';
    process.env.AI_API_KEY = 'gsk_parcial';
    // AI_MODEL ausente

    const chain = buildProviderChain();
    expect(chain).toHaveLength(0);
  });

  test('AI_BASE_URL malformada é ignorada em vez de derrubar a geração', () => {
    process.env.AI_BASE_URL = 'nao-e-uma-url';
    process.env.AI_API_KEY = 'x';
    process.env.AI_MODEL = 'y';

    expect(buildProviderChain()).toHaveLength(0);
  });

  test('chave Gemini fora do formato AIza é descartada (token OAuth não serve)', () => {
    process.env.GEMINI_API_KEY = 'AQ.tokenOAuthQueNaoFuncionaNoEndpoint';

    const chain = buildProviderChain();
    expect(chain.some((p) => p.name.startsWith('google:'))).toBe(false);
  });

  test('ordem final: compatível → Gemini → OpenAI → Anthropic', () => {
    process.env.AI_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.AI_API_KEY = 'ollama';
    process.env.AI_MODEL = 'llama3.2';
    process.env.GEMINI_API_KEY = 'AIzaChaveDeTeste0000000000000000000000';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    const names = buildProviderChain().map((p) => p.name.split(':')[0]);
    expect(names).toEqual(['compat', 'google', 'openai', 'anthropic']);
  });
});
