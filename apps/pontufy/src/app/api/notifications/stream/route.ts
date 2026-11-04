import { NextRequest } from 'next/server';
import { getSessionContext } from '@/backend/session';
import { getRedis } from '@/lib/redis';
import { sseChannelKey } from '@/infra/sse';

const POLL_MS = 1000;
const encode = (s: string) => new TextEncoder().encode(s);

/**
 * Stream SSE das notificações do usuário autenticado.
 *
 * O canal é POR USUÁRIO (`sse:{tenantId}:{userId}`). Antes era por tenant, e
 * todo colaborador conectado recebia o conteúdo das notificações dos colegas.
 * A publicação vive em `src/infra/sse.ts`.
 */
export async function GET(request: NextRequest) {
  let session;
  try {
    session = await getSessionContext();
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const { tenantId, userId } = session;
  const redis = getRedis();
  const key = sseChannelKey(tenantId, userId);

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encode(`event: connected\ndata: ${JSON.stringify({ userId, tenantId })}\n\n`),
      );

      // Start at the current tail so we don't replay events that arrived before this connection.
      let pos = redis ? await redis.llen(key) : 0;

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepAlive);
        }
      }, 20_000);

      const poll = async () => {
        if (request.signal.aborted) return;
        if (redis) {
          try {
            const items = await redis.lrange(key, pos, -1);
            if (items && items.length > 0) {
              pos += items.length;
              for (const item of items) {
                try {
                  const msg = JSON.parse(String(item)) as { type: string; data: unknown };
                  controller.enqueue(
                    encode(`event: ${msg.type}\ndata: ${JSON.stringify(msg.data)}\n\n`),
                  );
                } catch {}
              }
            }
          } catch {}
        }
        if (!request.signal.aborted) {
          setTimeout(poll, POLL_MS);
        }
      };

      setTimeout(poll, POLL_MS);

      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
