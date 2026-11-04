import {
  buildAuthHeader,
  buildSubmitBody,
  extractJobId,
  extractVideoUrl,
  normalizeStatus,
  primaryVideoProvider,
  readVideoProviders,
  type RenderJob,
  type RenderRequest,
  type VideoProviderConfig,
} from './video-providers';

// ═══════════════════════════════════════════════════════════════════════════
// Render de vídeo (assíncrono)
//
// Geração de vídeo leva de dezenas de segundos a alguns minutos — não cabe em
// request de server action. O desenho é o padrão de job:
//
//   submitRender() → { jobId, statusUrl }   (segundos)
//   pollRender()   → pending | running | done + url
//   renderVideo()  → submit + poll até o teto de tempo
//
// `renderVideo` nunca lança: sem provedor configurado, devolve
// `{ ok: false, reason: 'not-configured' }` e o player segue com o roteiro
// narrado. Vídeo renderizado é enriquecimento, não pré-requisito de aula.
// ═══════════════════════════════════════════════════════════════════════════

export interface RenderResult {
  ok: boolean;
  videoUrl?: string;
  providerId?: string;
  durationMs?: number;
  reason?: 'not-configured' | 'submit-failed' | 'timeout' | 'provider-error';
  detail?: string;
}

function urlsFor(provider: VideoProviderConfig, jobId: string): { statusUrl: string; resultUrl: string } {
  if (provider.transport === 'replicate') {
    return {
      statusUrl: `${provider.baseUrl}/predictions/${jobId}`,
      resultUrl: `${provider.baseUrl}/predictions/${jobId}`,
    };
  }
  // fal expõe o resultado no próprio status; `/requests/{id}` devolve o output.
  return {
    statusUrl: `${provider.baseUrl}/${provider.model}/requests/${jobId}/status`,
    resultUrl: `${provider.baseUrl}/${provider.model}/requests/${jobId}`,
  };
}

/** Submete o render. Lança em erro de rede/HTTP — quem chama trata. */
export async function submitRender(
  request: RenderRequest,
  provider: VideoProviderConfig | null = primaryVideoProvider(),
): Promise<RenderJob | null> {
  if (!provider) return null;

  const seconds = Math.min(Math.max(2, Math.round(request.seconds)), provider.maxSeconds);
  const response = await fetch(`${provider.baseUrl}/${provider.transport === 'replicate' ? 'predictions' : provider.model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeader(provider),
    },
    body: JSON.stringify(buildSubmitBody(provider, { ...request, seconds })),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`submit ${response.status}: ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  const jobId = extractJobId(provider, payload);
  if (!jobId) throw new Error('resposta de submissão sem id de job');

  const { statusUrl, resultUrl } = urlsFor(provider, jobId);
  return { provider, jobId, statusUrl, resultUrl };
}

export interface PollResult {
  status: 'pending' | 'running' | 'done' | 'failed';
  videoUrl?: string;
  detail?: string;
}

export async function pollRender(job: RenderJob): Promise<PollResult> {
  const headers = { ...buildAuthHeader(job.provider) };

  const statusResponse = await fetch(job.statusUrl, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!statusResponse.ok) {
    return { status: 'failed', detail: `status ${statusResponse.status}` };
  }

  const statusPayload = await statusResponse.json();
  const status = normalizeStatus(statusPayload);

  if (status === 'failed') {
    const detail = JSON.stringify(statusPayload).slice(0, 200);
    return { status: 'failed', detail };
  }
  if (status !== 'done') return { status };

  const urlFromStatus = extractVideoUrl(statusPayload);
  if (urlFromStatus) return { status: 'done', videoUrl: urlFromStatus };

  // Alguns provedores só devolvem a mídia no endpoint de resultado.
  const resultResponse = await fetch(job.resultUrl, { headers, signal: AbortSignal.timeout(20_000) });
  if (!resultResponse.ok) {
    return { status: 'failed', detail: `result ${resultResponse.status}` };
  }
  const resultPayload = await resultResponse.json();
  const url = extractVideoUrl(resultPayload);
  return url ? { status: 'done', videoUrl: url } : { status: 'failed', detail: 'resultado sem URL de vídeo' };
}

export interface RenderOptions {
  /** Teto total do job (submit + polling). */
  timeoutMs?: number;
  intervalMs?: number;
  onProgress?: (status: PollResult['status']) => void;
}

/**
 * Fluxo completo com teto de tempo.
 *
 * O intervalo começa em 3s e dobra até 15s: vídeo curto fica pronto em ~40s e
 * não faz sentido bater no provedor a cada segundo.
 */
export async function renderVideo(
  request: RenderRequest,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const startedAt = Date.now();
  const provider = primaryVideoProvider();
  if (!provider) {
    return { ok: false, reason: 'not-configured' };
  }

  const timeoutMs = options.timeoutMs ?? Number(process.env.VIDEO_RENDER_TIMEOUT_MS || 240_000);
  let interval = options.intervalMs ?? 3_000;

  let job: RenderJob | null = null;
  try {
    job = await submitRender(request, provider);
  } catch (err) {
    return {
      ok: false,
      reason: 'submit-failed',
      providerId: provider.preset.id,
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
  if (!job) return { ok: false, reason: 'not-configured' };

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    interval = Math.min(15_000, Math.round(interval * 1.6));

    try {
      const poll = await pollRender(job);
      options.onProgress?.(poll.status);

      if (poll.status === 'done' && poll.videoUrl) {
        return {
          ok: true,
          videoUrl: poll.videoUrl,
          providerId: provider.preset.id,
          durationMs: Date.now() - startedAt,
        };
      }
      if (poll.status === 'failed') {
        return {
          ok: false,
          reason: 'provider-error',
          providerId: provider.preset.id,
          detail: poll.detail,
        };
      }
    } catch (err) {
      // Falha de rede no polling não aborta: o job pode continuar vivo.
      options.onProgress?.('pending');
      if (Date.now() - startedAt >= timeoutMs) break;
      void err;
    }
  }

  return { ok: false, reason: 'timeout', providerId: provider.preset.id };
}

/** Diagnóstico para o admin: quais provedores existem e qual é o preferido. */
export function describeVideoProviders() {
  const providers = readVideoProviders();
  return {
    configured: providers.length > 0,
    preferred: providers[0]?.preset.id ?? null,
    providers: providers.map((provider) => ({
      id: provider.preset.id,
      label: provider.preset.label,
      transport: provider.transport,
      license: provider.preset.license,
      maxSeconds: provider.maxSeconds,
      resolution: provider.preset.resolution,
      nativeAudio: provider.preset.nativeAudio,
    })),
  };
}
