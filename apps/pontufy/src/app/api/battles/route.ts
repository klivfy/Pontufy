import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/infra/session';
import { jsonError } from '@/domain/auth';
import { createChallenge, listMyBattles } from '@/domain/battles';
import { logAudit, extractRequestMeta } from '@/lib/audit';
import { parseBody } from '@/lib/validations';
import { logger } from '@/infra/logger';

const createSchema = z.object({
  opponentId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const { tenantId, userId } = await getSessionContext();
    const raw = await request.json().catch(() => null);
    const { data, error } = parseBody(createSchema, raw);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const result = await createChallenge(tenantId, userId, data.opponentId);
    const meta = extractRequestMeta(request);
    await logAudit({
      tenantId,
      userId,
      action: 'BATTLE_CREATED',
      entity: 'Battle',
      entityId: result.battleId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newValue: { opponentId: data.opponentId, questions: result.questionsCount },
    });
    return NextResponse.json({ success: true, battleId: result.battleId });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('POST /api/battles', { error: String(error) }, 'battles');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function GET() {
  try {
    const { tenantId, userId } = await getSessionContext();
    const battles = await listMyBattles(tenantId, userId);
    return NextResponse.json({ success: true, battles });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('GET /api/battles', { error: String(error) }, 'battles');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
