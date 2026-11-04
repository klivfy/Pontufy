import { getRawPrisma } from '@/infra/platform-db';
import { logger } from '@/infra/logger';

// ═══════════════════════════════════════════════════════════════════════════
// A4 — Reconciliação saldo × ledger
//
// `User.pointsBalance` é um cache do `PointsLedger`. O débito é atômico
// (UPDATE condicional) e há constraint de não-negatividade, mas nada garante,
// ao longo do tempo, que saldo e soma do ledger continuem iguais: um bug, uma
// migração manual ou um job interrompido podem divergir os dois em silêncio.
//
// Este módulo COMPARA e REPORTA. Não corrige sozinho — corrigir automaticamente
// um saldo é mascarar a causa e pode beneficiar ou prejudicar usuário sem
// decisão humana.
//
// Convenção do ledger: `type = 'gain'` soma; `type = 'loss'` subtrai. O
// `pointsAmount` é sempre positivo.
// ═══════════════════════════════════════════════════════════════════════════

export interface DriftRow {
  userId: string;
  tenantId: string;
  balance: number;
  ledgerSum: number;
  delta: number;
}

export interface LotDriftRow {
  userId: string;
  tenantId: string;
  balance: number;
  lotsRemaining: number;
  delta: number;
}

export interface ReconcileResult {
  checkedAt: string;
  usersChecked: number;
  drift: DriftRow[];
  /** A1 — divergência entre saldo e soma dos lotes. */
  lotDrift: LotDriftRow[];
  /** Tolerância aplicada (divergência menor ou igual é ignorada). */
  tolerance: number;
}

/**
 * Compara o saldo de cada usuário com a soma do seu ledger.
 *
 * @param tolerance divergência aceita sem alerta (padrão 0 — centavo exato).
 */
export async function reconcilePointsBalances(tolerance = 0): Promise<ReconcileResult> {
  const prisma = getRawPrisma();

  // Uma única query: soma o ledger por usuário e junta com o saldo.
  // Sem laço em Node — o custo é do banco, não da função serverless.
  const rows = await prisma.$queryRaw<
    Array<{ id: string; tenantId: string; pointsBalance: number; ledgerSum: bigint | number | null }>
  >`
    SELECT u."id",
           u."tenantId",
           u."pointsBalance",
           COALESCE(SUM(
             CASE WHEN l."type" = 'gain' THEN l."pointsAmount"
                  WHEN l."type" = 'loss' THEN -l."pointsAmount"
                  ELSE 0 END
           ), 0) AS "ledgerSum"
    FROM "User" u
    LEFT JOIN "PointsLedger" l ON l."userId" = u."id"
    GROUP BY u."id", u."tenantId", u."pointsBalance"
  `;

  const drift: DriftRow[] = [];
  for (const row of rows) {
    const ledgerSum = Number(row.ledgerSum ?? 0);
    const delta = Number(row.pointsBalance) - ledgerSum;
    if (Math.abs(delta) > tolerance) {
      drift.push({
        userId: row.id,
        tenantId: row.tenantId,
        balance: Number(row.pointsBalance),
        ledgerSum,
        delta,
      });
    }
  }

  const result: ReconcileResult = {
    checkedAt: new Date().toISOString(),
    usersChecked: rows.length,
    drift,
    lotDrift: await reconcileLotInvariant(tolerance),
    tolerance,
  };

  if (drift.length > 0) {
    logger.error('Reconciliação encontrou divergência entre saldo e ledger', {
      usersChecked: result.usersChecked,
      driftCount: drift.length,
      // Amostra: o log não pode virar despejo de banco.
      sample: drift.slice(0, 5),
    }, 'points');
  } else {
    logger.info('Reconciliação sem divergências', { usersChecked: result.usersChecked }, 'points');
  }

  if (result.lotDrift.length > 0) {
    logger.error('Invariante dos lotes violado (SUM(remaining) != saldo)', {
      driftCount: result.lotDrift.length,
      sample: result.lotDrift.slice(0, 5),
    }, 'points');
  }

  return result;
}

/**
 * A1 — `SUM(PointsLot.remaining)` precisa ser igual ao saldo de cada usuário.
 *
 * Se divergir, significa que algum caminho mexeu no saldo sem passar por
 * `creditPoints`/`debitPoints`/expiração. É o alerta que torna o lote
 * confiável; sem ele, o invariante é uma promessa no comentário.
 */
async function reconcileLotInvariant(tolerance: number): Promise<LotDriftRow[]> {
  const prisma = getRawPrisma();

  const rows = await prisma.$queryRaw<
    Array<{ id: string; tenantId: string; pointsBalance: number; lotsRemaining: bigint | number | null }>
  >`
    SELECT u."id",
           u."tenantId",
           u."pointsBalance",
           COALESCE(SUM(l."remaining"), 0) AS "lotsRemaining"
    FROM "User" u
    LEFT JOIN "PointsLot" l ON l."userId" = u."id"
    GROUP BY u."id", u."tenantId", u."pointsBalance"
  `;

  const drift: LotDriftRow[] = [];
  for (const row of rows) {
    const lotsRemaining = Number(row.lotsRemaining ?? 0);
    const delta = Number(row.pointsBalance) - lotsRemaining;
    if (Math.abs(delta) > tolerance) {
      drift.push({
        userId: row.id,
        tenantId: row.tenantId,
        balance: Number(row.pointsBalance),
        lotsRemaining,
        delta,
      });
    }
  }

  return drift;
}
