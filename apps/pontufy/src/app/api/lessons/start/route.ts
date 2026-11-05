import { NextResponse } from 'next/server';
import { z } from 'zod';

import { jsonError } from '@/domain/auth';
import { recordLessonStart } from '@/domain/learning';
import { withRouteMetrics } from '@/infra/metrics';
import { logger } from '@/infra/logger';
import { getSessionContext } from '@/infra/session';
import { getClientIp, ipRateLimit } from '@/lib/security/auth-guard';
import { parseBody } from '@/lib/validations';

// ═══════════════════════════════════════════════════════════════════════════
// "Aula aberta" — telemetria que fecha o funil de adoção
//
// O player é client component e só avisava o servidor ao CONCLUIR a aula. O
// funil, por isso, tinha três degraus e escondia a pergunta mais útil: quantos
// abrem e desistem.
//
// Decisões:
//  • Idempotente por (usuário, aula): o player chama a cada troca de aula, e
//    repetir não cria linha nova nem infla a métrica.
//  • Nunca derruba a aula: erro aqui é registrado e devolvido, mas o player
//    não bloqueia a leitura por causa de telemetria.
//  • Rate limit mais folgado que o de conclusão — trocar de aula é navegação
//    normal, não ação de negócio.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

const START_SCHEMA = z.object({
  lessonId: z.string().trim().min(1).max(120),
});

const START_IP_MAX = 120;
const START_IP_WINDOW = 60;

async function handlePost(request: Request) {
  try {
    const ip = getClientIp(request);
    const ipRate = await ipRateLimit(ip, 'lessons-start', START_IP_MAX, START_IP_WINDOW);
    if (!ipRate.allowed) {
      return NextResponse.json({ error: 'Muitas requisições. Aguarde um instante.' }, { status: 429 });
    }

    const { tenantId, userId } = await getSessionContext();

    const raw = await request.json().catch(() => null);
    const { data, error } = parseBody(START_SCHEMA, raw);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const result = await recordLessonStart({ tenantId, userId, lessonId: data.lessonId });

    return NextResponse.json({ success: true, firstOpen: result.firstOpen });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) {
      logger.error('POST /api/lessons/start', { error: String(error) }, 'learning');
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: Request) {
  return withRouteMetrics('lessons/start', () => handlePost(request));
}
