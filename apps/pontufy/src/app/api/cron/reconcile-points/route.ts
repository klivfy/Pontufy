import { NextResponse } from 'next/server';

import { reconcilePointsBalances } from '@/domain/points/reconcile';
import { logger } from '@/infra/logger';
import { authorizeCronRequest } from '@/lib/security/cron-auth';
import { acquireJobLock } from '@/infra/job-lock';

// ═══════════════════════════════════════════════════════════════════════════
// A4 — Job de reconciliação (somente leitura)
//
// Não corrige nada: devolve a lista de divergências para investigação. Um job
// que "conserta" saldo apaga a evidência do bug que causou a divergência.
//
// Agendamento sugerido: 1x/dia, fora dos horários de pico.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const lock = await acquireJobLock('cron:reconcile-points');
  if (!lock.acquired) {
    return NextResponse.json({ skipped: true, reason: 'locked' }, { status: 200 });
  }

  try {
    const result = await reconcilePointsBalances();

    return NextResponse.json({
      success: true,
      usersChecked: result.usersChecked,
      driftCount: result.drift.length,
      // Limite de resposta: o operador vê os primeiros e o log tem a amostra.
      drift: result.drift.slice(0, 50),
      checkedAt: result.checkedAt,
    });
  } catch (error) {
    logger.error('Falha na reconciliação de pontos', { error: String(error) }, 'points');
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  } finally {
    await lock.release();
  }
}
