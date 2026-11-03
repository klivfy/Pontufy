import { test, expect } from '@playwright/test';
import { generateCourseWithFallback } from '../../src/domain/ai/course-engine';
import {
  startFakeProvider,
  configureFakeSlot,
  clearProviderEnv,
  makeValidCourse,
  type FakeProvider,
} from '../helpers/fake-provider';

// ═══════════════════════════════════════════════════════════════════════════
// Motor de geração de cursos — contrato de fallback, sem rede e sem cota.
//
// Usa um provedor HTTP local que simula respostas boas, 429, lixo e lentidão.
// É o que permite testar em CI o que antes só se descobria em produção:
// qual provedor respondeu, se houve recuperação em modo JSON e se o motor
// desistiu para o template local.
// ═══════════════════════════════════════════════════════════════════════════

const PROMPT = 'Treinamento de LGPD para colaboradores';
const SECTOR = 'compliance';

let providers: FakeProvider[] = [];

test.beforeEach(async () => {
  clearProviderEnv();
  providers = [];
});

test.afterEach(async () => {
  await Promise.all(providers.map((p) => p.close()));
  providers = [];
  clearProviderEnv();
});

async function fake(options: Parameters<typeof startFakeProvider>[0]): Promise<FakeProvider> {
  const provider = await startFakeProvider(options);
  providers.push(provider);
  return provider;
}

test.describe('motor de geração de cursos', () => {
  test('responde com o conteúdo do provedor e normaliza pelo schema canônico', async () => {
    const provider = await fake({ mode: 'ok' });
    configureFakeSlot(1, provider);

    const result = await generateCourseWithFallback(PROMPT, SECTOR);

    expect(result.provider).toBe('compat:fake-model-1');
    expect(result.errors).toBeUndefined();
    expect(result.data.lessons).toHaveLength(3);
    expect(result.data.quiz).toHaveLength(2);
    // Campos com `.default()` no schema canônico existem mesmo que o modelo
    // não os tenha enviado (aqui o fake envia todos).
    expect(result.data.category).toBe('Compliance');
    expect(result.data.lessons[0].pointsAwarded).toBe(20);
    expect(provider.requests()).toBeGreaterThan(0);
    // IA-2 — telemetria: provedor, latência e tentativas ficam registrados.
    expect(result.meta.provider).toBe('compat:fake-model-1');
    expect(result.meta.usedFallback).toBe(false);
    expect(result.meta.usedJsonMode).toBe(false);
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.meta.attempts).toHaveLength(1);
    expect(result.meta.attempts[0].ok).toBe(true);
  });

  test('429 no primeiro provedor cai para o segundo', async () => {
    const failing = await fake({ mode: 'http-error', status: 429 });
    const healthy = await fake({ mode: 'ok' });
    configureFakeSlot(1, failing);
    configureFakeSlot(2, healthy);

    const result = await generateCourseWithFallback(PROMPT, SECTOR);

    expect(result.provider).toBe('compat:fake-model-2');
    expect(result.meta.attempts[0]).toMatchObject({ provider: 'compat:fake-model-1', ok: false });
    expect(result.meta.attempts[1]).toMatchObject({ provider: 'compat:fake-model-2', ok: true });
    expect(failing.requests()).toBeGreaterThan(0);
    expect(result.data.lessons.length).toBeGreaterThanOrEqual(3);
  });

  test('resposta sem JSON nos dois provedores termina no template local, com erros registrados', async () => {
    const first = await fake({ mode: 'garbage' });
    const second = await fake({ mode: 'garbage' });
    configureFakeSlot(1, first);
    configureFakeSlot(2, second);

    const result = await generateCourseWithFallback(PROMPT, SECTOR);

    expect(result.provider).toBe('local:fallback');
    expect(result.meta.usedFallback).toBe(true);
    expect(result.meta.attempts.length).toBeGreaterThanOrEqual(2);
    // Cada provedor falha duas vezes: structured output e recuperação em JSON.
    expect(result.errors?.length).toBeGreaterThanOrEqual(2);
    expect(result.errors?.join(' ')).toContain('compat:fake-model-1');
    // O template precisa continuar entregando um curso utilizável.
    expect(result.data.lessons.length).toBeGreaterThanOrEqual(3);
  });

  test('provedor que não responde estoura o timeout e o próximo assume', async () => {
    const slow = await fake({ mode: 'hang', delayMs: 8_000 });
    const healthy = await fake({ mode: 'ok' });
    configureFakeSlot(1, slow, { timeoutMs: '600' });
    configureFakeSlot(2, healthy);

    const startedAt = Date.now();
    const result = await generateCourseWithFallback(PROMPT, SECTOR);
    const elapsed = Date.now() - startedAt;

    expect(result.provider).toBe('compat:fake-model-2');
    // Não pode esperar os 8s do provedor lento.
    expect(elapsed).toBeLessThan(7_000);
  });

  test('STRUCTURED=json vai direto ao modo JSON e extrai JSON de cerca markdown', async () => {
    const provider = await fake({ mode: 'ok', fenced: true });
    configureFakeSlot(1, provider, { structured: 'json' });

    const result = await generateCourseWithFallback(PROMPT, SECTOR);

    expect(result.provider).toBe('compat:fake-model-1 (json-mode)');
    expect(result.meta.usedJsonMode).toBe(true);
    expect(result.data.title).toContain('LGPD');
    // Sem structured output: o corpo enviado não pede response_format.
    const body = provider.lastBody() as Record<string, unknown> | null;
    expect(body?.response_format).toBeUndefined();
  });

  test('STRUCTURED=schema envia response_format ao provedor', async () => {
    const provider = await fake({ mode: 'ok' });
    configureFakeSlot(1, provider, { structured: 'schema' });

    await generateCourseWithFallback(PROMPT, SECTOR);

    const body = provider.lastBody() as Record<string, unknown> | null;
    expect(body?.response_format).toBeTruthy();
  });

  test('sem provedor configurado usa o template e identifica a origem', async () => {
    const result = await generateCourseWithFallback(PROMPT, SECTOR);

    expect(result.provider).toBe('local:template');
    expect(result.errors).toBeUndefined();
    expect(result.data.lessons.length).toBeGreaterThanOrEqual(3);
  });

  test('curso inválido (menos de 3 aulas) é rejeitado e cai para o template', async () => {
    const invalid = makeValidCourse({
      lessons: [
        {
          title: 'Aula única',
          content: 'x'.repeat(250),
          pointsAwarded: 20,
          order: 1,
        },
      ],
    });
    const provider = await fake({ mode: 'ok', course: invalid });
    configureFakeSlot(1, provider, { structured: 'json' });

    const result = await generateCourseWithFallback(PROMPT, SECTOR);

    expect(result.provider).toBe('local:fallback');
    expect(result.errors?.length).toBeGreaterThan(0);
  });
});
