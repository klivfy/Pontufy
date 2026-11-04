// ═══════════════════════════════════════════════════════════════════════════
// Provedores de vídeo — registro e transporte
//
// Não existe API de geração de vídeo gratuita e durável. O que existe:
//
//   • pesos abertos (Wan 2.2, CogVideoX-2B, Mochi 1 — Apache 2.0) que você roda
//     na sua GPU: custo marginal zero, custo de infra real;
//   • licenças comunitárias (LTX-2.3, HunyuanVideo 1.5) gratuitas abaixo de um
//     teto de receita/usuários;
//   • créditos de teste em provedores hospedados (fal, Replicate, WaveSpeed,
//     Apiframe) — serve para validar, não para servir cliente.
//
// Este módulo implementa o transporte, não o modelo: o mesmo cliente HTTP fala
// com qualquer endpoint assíncrono no padrão "submete → consulta → resultado",
// que é como fal, Replicate e WaveSpeed expõem os três modelos escolhidos.
// Trocar de provedor é trocar variável de ambiente, não código.
//
// Configuração (slots, como AI_1_* … AI_10_*):
//
//   VIDEO_1_PROVIDER=wan-2.2
//   VIDEO_1_TRANSPORT=fal
//   VIDEO_1_BASE_URL=https://queue.fal.run
//   VIDEO_1_MODEL=fal-ai/wan-22/text-to-video
//   VIDEO_1_API_KEY=...
//   VIDEO_1_MAX_SECONDS=10
// ═══════════════════════════════════════════════════════════════════════════

export type VideoProviderId = 'wan-2.2' | 'ltx-2.3' | 'cogvideox-2b' | 'hunyuan-1.5';
export type VideoTransport = 'fal' | 'replicate' | 'generic';

export interface VideoProviderPreset {
  id: VideoProviderId;
  label: string;
  /** Licença que precisa ser respeitada para uso comercial. */
  license: string;
  /** Piso de VRAM se for self-host (referência de custo). */
  vramGb: number;
  maxSeconds: number;
  resolution: string;
  /** Gera áudio sincronizado no mesmo passo (LTX-2.3). */
  nativeAudio: boolean;
}

export const VIDEO_PRESETS: Record<VideoProviderId, VideoProviderPreset> = {
  'wan-2.2': {
    id: 'wan-2.2',
    label: 'Wan 2.2 (Alibaba)',
    license: 'Apache 2.0 — uso comercial sem restrição',
    vramGb: 8,
    maxSeconds: 10,
    resolution: '720p',
    nativeAudio: false,
  },
  'ltx-2.3': {
    id: 'ltx-2.3',
    label: 'LTX-2.3 (Lightricks)',
    license: 'LTX Community/Commercial — grátis até US$10M de receita anual',
    vramGb: 16,
    maxSeconds: 20,
    resolution: '4K',
    nativeAudio: true,
  },
  'cogvideox-2b': {
    id: 'cogvideox-2b',
    label: 'CogVideoX-2B (Zhipu/THUDM)',
    license: 'Apache 2.0 — uso comercial sem restrição',
    vramGb: 16,
    maxSeconds: 6,
    resolution: '720p',
    nativeAudio: false,
  },
  'hunyuan-1.5': {
    id: 'hunyuan-1.5',
    label: 'HunyuanVideo 1.5 (Tencent)',
    license: 'Tencent Community — grátis até 100M MAU',
    vramGb: 14,
    maxSeconds: 5,
    resolution: '1080p',
    nativeAudio: false,
  },
};

export interface VideoProviderConfig {
  sequence: number;
  preset: VideoProviderPreset;
  transport: VideoTransport;
  baseUrl: string;
  model: string;
  apiKey: string;
  maxSeconds: number;
}

const MAX_VIDEO_SLOTS = 5;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseTransport(raw: string | undefined): VideoTransport {
  const value = raw?.toLowerCase();
  return value === 'fal' || value === 'replicate' || value === 'generic' ? value : 'fal';
}

/**
 * Lê os slots configurados, na ordem de prioridade.
 *
 * Slot parcial é ignorado com aviso — o sintoma silencioso de "configurei e não
 * usa" é pior do que um log no boot.
 */
export function readVideoProviders(): VideoProviderConfig[] {
  const out: VideoProviderConfig[] = [];

  for (let i = 1; i <= MAX_VIDEO_SLOTS; i++) {
    const slot = `VIDEO_${i}`;
    const providerId = env(`${slot}_PROVIDER`);
    if (!providerId) continue;

    const preset = VIDEO_PRESETS[providerId as VideoProviderId];
    if (!preset) {
      console.warn(`[video] ${slot}: provedor desconhecido ("${providerId}") — ignorado.`);
      continue;
    }

    const baseUrl = env(`${slot}_BASE_URL`) ?? (env(`${slot}_TRANSPORT`) === 'replicate' ? 'https://api.replicate.com/v1' : undefined);
    const model = env(`${slot}_MODEL`);
    const apiKey = env(`${slot}_API_KEY`);

    if (!baseUrl || !model || !apiKey) {
      console.warn(
        `[video] ${slot} (${providerId}) ignorado: defina ${slot}_BASE_URL, ${slot}_MODEL e ${slot}_API_KEY juntos.`,
      );
      continue;
    }

    out.push({
      sequence: i,
      preset,
      transport: parseTransport(env(`${slot}_TRANSPORT`)),
      baseUrl: baseUrl.replace(/\/$/, ''),
      model,
      apiKey,
      maxSeconds: Number(env(`${slot}_MAX_SECONDS`)) || preset.maxSeconds,
    });
  }

  return out;
}

/** Provedor preferido: primeiro configurado. `null` = nenhum (modo roteiro). */
export function primaryVideoProvider(): VideoProviderConfig | null {
  return readVideoProviders()[0] ?? null;
}

export interface RenderRequest {
  /** Cena em linguagem natural, em inglês (os modelos foram treinados assim). */
  prompt: string;
  seconds: number;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  seed?: number;
}

export interface RenderJob {
  provider: VideoProviderConfig;
  jobId: string;
  statusUrl: string;
  resultUrl: string;
}

/** Corpo do POST, por transporte. Exposto para teste — é o contrato do provedor. */
export function buildSubmitBody(provider: VideoProviderConfig, request: RenderRequest): unknown {
  if (provider.transport === 'replicate') {
    return {
      version: provider.model,
      input: {
        prompt: request.prompt,
        num_frames: Math.round(request.seconds * 16),
        aspect_ratio: request.aspectRatio ?? '16:9',
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
      },
    };
  }

  // fal e compatíveis (`generic`) usam o input direto no corpo.
  return {
    prompt: request.prompt,
    duration: request.seconds,
    aspect_ratio: request.aspectRatio ?? '16:9',
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
  };
}

/** Cabeçalho de autenticação por transporte. */
export function buildAuthHeader(provider: VideoProviderConfig): Record<string, string> {
  if (provider.transport === 'replicate') {
    return { Authorization: `Bearer ${provider.apiKey}` };
  }
  // fal usa `Key <token>`.
  return { Authorization: `Key ${provider.apiKey}` };
}

/** Extrai o id do job da resposta de submissão. */
export function extractJobId(provider: VideoProviderConfig, payload: unknown): string | null {
  const obj = (payload ?? {}) as Record<string, unknown>;
  const candidates =
    provider.transport === 'replicate'
      ? [obj.id]
      : [obj.request_id, (obj.data as Record<string, unknown> | undefined)?.id, obj.id, obj.task_id];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return null;
}

/**
 * Extrai a URL do vídeo pronto.
 *
 * Cada provedor devolve em um lugar diferente; a lista cobre os formatos
 * conhecidos. Devolver `null` significa "ainda não está pronto", não erro.
 */
export function extractVideoUrl(payload: unknown): string | null {
  const obj = (payload ?? {}) as Record<string, unknown>;

  const direct = [obj.video_url, obj.url, obj.output_url];
  for (const candidate of direct) {
    if (typeof candidate === 'string' && candidate.startsWith('http')) return candidate;
  }

  const video = obj.video as Record<string, unknown> | string | undefined;
  if (typeof video === 'string' && video.startsWith('http')) return video;
  if (video && typeof video === 'object' && typeof video.url === 'string') return video.url;

  const output = obj.output;
  if (typeof output === 'string' && output.startsWith('http')) return output;
  if (Array.isArray(output)) {
    const first = output.find((item) => typeof item === 'string' && item.startsWith('http'));
    if (typeof first === 'string') return first;
  }

  const data = obj.data as Record<string, unknown> | undefined;
  if (data) {
    const nested = extractVideoUrl(data);
    if (nested) return nested;
  }

  return null;
}

/** Status normalizado: os provedores usam nomes diferentes para o mesmo estado. */
export function normalizeStatus(payload: unknown): 'pending' | 'running' | 'done' | 'failed' {
  const obj = (payload ?? {}) as Record<string, unknown>;
  const raw = String(obj.status ?? obj.state ?? (obj.data as Record<string, unknown> | undefined)?.status ?? '').toLowerCase();

  if (['failed', 'error', 'canceled', 'cancelled'].includes(raw)) return 'failed';
  if (['succeeded', 'success', 'completed', 'complete', 'done'].includes(raw)) return 'done';
  if (['processing', 'running', 'in_progress', 'started'].includes(raw)) return 'running';
  return 'pending';
}
