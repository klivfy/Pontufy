import { NextResponse } from 'next/server';

import { jsonError, requireSuperAdmin } from '@/domain/auth';
import { metricsSnapshot } from '@/infra/metrics';
import { logger } from '@/infra/logger';

// ═══════════════════════════════════════════════════════════════════════════
// B4 — SLOs por rota (somente leitura)
//
// Entrega latência p50/p95 e taxa de erro das rotas críticas medidas nesta
// instância. Não é série temporal: em serverless o buffer é local e some no
// cold start — está documentado em `infra/metrics.ts` e no plano.
//
// Acesso restrito a super_admin: é informação operacional de plataforma.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireSuperAdmin();

    const routes = metricsSnapshot();

    return NextResponse.json({
      scope: 'instância',
      disclaimer:
        'Amostras em memória do processo: cada instância tem o seu buffer e cold start zera. ' +
        'Para SLO de produção é preciso agregação externa.',
      routes,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) {
      logger.error('GET /api/superadmin/metrics', { error: String(error) }, 'metrics');
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
