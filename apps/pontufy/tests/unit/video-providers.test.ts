import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  VIDEO_PRESETS,
  buildAuthHeader,
  buildSubmitBody,
  extractJobId,
  extractVideoUrl,
  normalizeStatus,
  readVideoProviders,
  type VideoProviderConfig,
} from '../../src/domain/ai/video-providers';
import { describeVideoProviders, renderVideo } from '../../src/domain/ai/video-engine';

// ═══════════════════════════════════════════════════════════════════════════
// Contrato dos provedores de vídeo.
//
// O transporte é genérico (submete → consulta → resultado) e cada provedor
// responde em um formato. Estes testes travam a tradução: se o mapeamento de
// status ou a extração da URL mudar, o render passa a "nunca ficar pronto" e o
// sintoma seria timeout no meio da madrugada, não erro de compilação.
// ═══════════════════════════════════════════════════════════════════════════

function provider(overrides: Partial<VideoProviderConfig> = {}): VideoProviderConfig {
  return {
    sequence: 1,
    preset: VIDEO_PRESETS['wan-2.2'],
    transport: 'fal',
    baseUrl: 'https://queue.fal.run',
    model: 'fal-ai/wan-22/text-to-video',
    apiKey: 'chave',
    maxSeconds: 10,
    ...overrides,
  };
}

const ENV_KEYS = [
  'VIDEO_1_PROVIDER',
  'VIDEO_1_TRANSPORT',
  'VIDEO_1_BASE_URL',
  'VIDEO_1_MODEL',
  'VIDEO_1_API_KEY',
  'VIDEO_1_MAX_SECONDS',
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

test('sem configuração, nenhum provedor e render indisponível (sem lançar)', async () => {
  assert.deepEqual(readVideoProviders(), []);
  assert.equal(describeVideoProviders().configured, false);

  const result = await renderVideo({ prompt: 'office', seconds: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-configured');
});

test('slot completo entra na fila; parcial é ignorado', () => {
  process.env.VIDEO_1_PROVIDER = 'wan-2.2';
  process.env.VIDEO_1_TRANSPORT = 'fal';
  process.env.VIDEO_1_BASE_URL = 'https://queue.fal.run';
  process.env.VIDEO_1_MODEL = 'fal-ai/wan-22/text-to-video';
  process.env.VIDEO_1_API_KEY = 'chave';
  process.env.VIDEO_1_MAX_SECONDS = '8';

  const providers = readVideoProviders();
  assert.equal(providers.length, 1);
  assert.equal(providers[0].maxSeconds, 8);

  // Remove a chave: o slot inteiro deixa de valer (configuração parcial).
  delete process.env.VIDEO_1_API_KEY;
  assert.equal(readVideoProviders().length, 0);
});

test('provedor desconhecido não entra', () => {
  process.env.VIDEO_1_PROVIDER = 'modelo-inventado';
  process.env.VIDEO_1_BASE_URL = 'https://x';
  process.env.VIDEO_1_MODEL = 'm';
  process.env.VIDEO_1_API_KEY = 'k';
  assert.equal(readVideoProviders().length, 0);
});

test('corpo de submissão: fal usa input direto, replicate usa version+input', () => {
  const falBody = buildSubmitBody(provider(), { prompt: 'a person typing', seconds: 4 }) as Record<string, unknown>;
  assert.equal(falBody.prompt, 'a person typing');
  assert.equal(falBody.duration, 4);

  const replicateBody = buildSubmitBody(provider({ transport: 'replicate' }), {
    prompt: 'a person typing',
    seconds: 4,
  }) as { version: string; input: Record<string, unknown> };
  assert.equal(replicateBody.version, 'fal-ai/wan-22/text-to-video');
  assert.equal(replicateBody.input.prompt, 'a person typing');
});

test('autenticação: fal usa "Key", replicate usa "Bearer"', () => {
  assert.deepEqual(buildAuthHeader(provider()), { Authorization: 'Key chave' });
  assert.deepEqual(buildAuthHeader(provider({ transport: 'replicate' })), {
    Authorization: 'Bearer chave',
  });
});

test('extrai id do job nos dois formatos', () => {
  assert.equal(extractJobId(provider(), { request_id: 'abc' }), 'abc');
  assert.equal(extractJobId(provider({ transport: 'replicate' }), { id: 'xyz' }), 'xyz');
  assert.equal(extractJobId(provider(), { nada: true }), null);
});

test('extrai URL de vídeo dos formatos conhecidos', () => {
  assert.equal(extractVideoUrl({ video: { url: 'https://cdn/v.mp4' } }), 'https://cdn/v.mp4');
  assert.equal(extractVideoUrl({ output: ['https://cdn/a.mp4'] }), 'https://cdn/a.mp4');
  assert.equal(extractVideoUrl({ data: { video_url: 'https://cdn/b.mp4' } }), 'https://cdn/b.mp4');
  assert.equal(extractVideoUrl({ output: { sem_url: true } }), null);
});

test('normaliza status dos provedores', () => {
  assert.equal(normalizeStatus({ status: 'IN_QUEUE' }), 'pending');
  assert.equal(normalizeStatus({ status: 'IN_PROGRESS' }), 'running');
  assert.equal(normalizeStatus({ status: 'COMPLETED' }), 'done');
  assert.equal(normalizeStatus({ status: 'succeeded' }), 'done');
  assert.equal(normalizeStatus({ status: 'failed' }), 'failed');
  assert.equal(normalizeStatus({}), 'pending');
});

test('cada preset declara licença, VRAM e limite de duração', () => {
  for (const preset of Object.values(VIDEO_PRESETS)) {
    assert.ok(preset.license.length > 10, `${preset.id} sem licença descrita`);
    assert.ok(preset.vramGb > 0);
    assert.ok(preset.maxSeconds >= 4);
  }
  // LTX-2.3 é a única com áudio nativo — é o diferencial que justifica o custo.
  assert.equal(VIDEO_PRESETS['ltx-2.3'].nativeAudio, true);
  assert.equal(VIDEO_PRESETS['wan-2.2'].nativeAudio, false);
});
