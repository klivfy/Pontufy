import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// ═══════════════════════════════════════════════════════════════════════════
// Provedor de IA falso — endpoint compatível com `POST /chat/completions`.
//
// Permite testar o motor de geração (cadeia de fallback, modo JSON, timeout,
// validação de schema) em CI, sem chave, sem rede e sem consumir cota gratuita.
// Cada instância simula um provedor com comportamento programável.
// ═══════════════════════════════════════════════════════════════════════════

export type FakeMode = 'ok' | 'http-error' | 'garbage' | 'hang';

export interface FakeProviderOptions {
  /** Comportamento da resposta. */
  mode?: FakeMode;
  /** Status HTTP quando `mode = 'http-error'` (padrão 429). */
  status?: number;
  /** Atraso antes de responder (usado com `hang`). */
  delayMs?: number;
  /** Sobrescreve o curso devolvido no modo `ok`. */
  course?: unknown;
  /** Envolve o JSON em cerca markdown ```json … ```. */
  fenced?: boolean;
}

export interface FakeProvider {
  /** Base URL para `AI_n_BASE_URL`. */
  baseUrl: string;
  /** Quantas requisições chegaram (inclui retries do SDK). */
  requests: () => number;
  /** Último corpo recebido, para inspeção. */
  lastBody: () => Record<string, unknown> | null;
  close: () => Promise<void>;
}

/** Curso válido segundo `courseGenerationSchema` (estrito, todos os campos). */
export function makeValidCourse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const lesson = (order: number) => ({
    title: `Aula ${order}: Fundamentos de LGPD`,
    content:
      `## Aula ${order}\n\n` +
      'Conteúdo didático sobre proteção de dados. '.repeat(8) +
      '\n\n- Base legal aplicável\n- Papel do DPO\n- Prazo de comunicação de incidentes',
    pointsAwarded: 20,
    order,
  });

  return {
    title: 'LGPD e Proteção de Dados para Colaboradores',
    description:
      'Curso obrigatório de conformidade com a LGPD, cobrindo bases legais, direitos dos titulares e resposta a incidentes.',
    category: 'Compliance',
    estimatedDurationMinutes: 90,
    lessons: [lesson(1), lesson(2), lesson(3)],
    quiz: [
      {
        question: 'Qual é o prazo para comunicar um incidente ao DPO?',
        options: ['24 horas', '7 dias', '30 dias'],
        correctIndex: 0,
        explanation: 'A política interna exige comunicação em até 24 horas.',
      },
      {
        question: 'O que é um dado pessoal sensível?',
        options: ['Nome completo', 'Dado biométrico', 'Endereço comercial'],
        correctIndex: 1,
        explanation: 'Biometria é dado sensível segundo a LGPD.',
      },
    ],
    ...overrides,
  };
}

export async function startFakeProvider(options: FakeProviderOptions = {}): Promise<FakeProvider> {
  const mode = options.mode ?? 'ok';
  const status = options.status ?? 429;
  const delayMs = options.delayMs ?? 5_000;
  const fenced = options.fenced ?? false;

  let requestCount = 0;
  let lastBody: Record<string, unknown> | null = null;

  const server: Server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }

    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      requestCount += 1;
      try {
        lastBody = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        lastBody = null;
      }

      if (mode === 'http-error') {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'rate limit exceeded (fake provider)', code: status },
          }),
        );
        return;
      }

      const respond = () => {
        if (mode === 'garbage') {
          const body = {
            id: 'fake-garbage',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Desculpe, não consigo responder em JSON hoje.' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
          return;
        }

        const payload = JSON.stringify(options.course ?? makeValidCourse());
        const content = fenced ? `\`\`\`json\n${payload}\n\`\`\`` : payload;
        const body = {
          id: 'fake-ok',
          object: 'chat.completion',
          choices: [
            { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 500, total_tokens: 600 },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (mode === 'hang') {
        setTimeout(respond, delayMs);
        return;
      }
      respond();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests: () => requestCount,
    lastBody: () => lastBody,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** Aponta um slot de provedor para o servidor falso. */
export function configureFakeSlot(
  slot: number,
  provider: FakeProvider,
  overrides: { structured?: string; timeoutMs?: string; maxTokens?: string; model?: string } = {},
): void {
  process.env[`AI_${slot}_LABEL`] = `Fake-${slot}`;
  process.env[`AI_${slot}_BASE_URL`] = provider.baseUrl;
  process.env[`AI_${slot}_API_KEY`] = 'fake-key';
  process.env[`AI_${slot}_MODEL`] = overrides.model ?? `fake-model-${slot}`;
  process.env[`AI_${slot}_STRUCTURED`] = overrides.structured ?? 'schema';
  process.env[`AI_${slot}_TIMEOUT_MS`] = overrides.timeoutMs ?? '10000';
  process.env[`AI_${slot}_MAX_TOKENS`] = overrides.maxTokens ?? '8192';
}

/** Remove a configuração de todos os slots e de provedores nativos. */
export function clearProviderEnv(): void {
  const fields = ['BASE_URL', 'API_KEY', 'MODEL', 'LABEL', 'STRUCTURED', 'TIMEOUT_MS', 'MAX_TOKENS'];
  for (let i = 1; i <= 10; i++) {
    for (const field of fields) delete process.env[`AI_${i}_${field}`];
  }
  for (const key of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_LABEL']) delete process.env[key];
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
}
