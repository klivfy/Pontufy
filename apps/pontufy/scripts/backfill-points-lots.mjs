// ═══════════════════════════════════════════════════════════════════════════
// A1 — Backfill de PointsLot a partir do ledger existente
//
// Reconstrói, por usuário, a alocação FIFO: cada `gain` vira um lote com
// validade; cada `loss`/`expiration` consome dos lotes mais antigos primeiro.
// O resultado é o `remaining` de cada lote, compatível com o saldo atual.
//
//   node scripts/backfill-points-lots.mjs            # dry-run (não grava)
//   node scripts/backfill-points-lots.mjs --apply    # grava
//
// Idempotente: recalcula do zero para cada usuário com movimentação.
// ═══════════════════════════════════════════════════════════════════════════
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const EXPIRY_MONTHS = Number(process.env.POINTS_EXPIRY_MONTHS ?? 12);

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

const rows = await prisma.$queryRaw`
  SELECT DISTINCT "userId", "tenantId" FROM "PointsLedger"
`;

let usersProcessed = 0;
let lotsCreated = 0;
let mismatch = 0;

for (const { userId, tenantId } of rows) {
  const entries = await prisma.pointsLedger.findMany({
    where: { userId, tenantId },
    orderBy: { timestamp: 'asc' },
    select: { id: true, type: true, pointsAmount: true, timestamp: true },
  });

  /** @type {Array<{ sourceLedgerId: string, amount: number, remaining: number, expiresAt: Date }>} */
  const lots = [];

  for (const entry of entries) {
    if (entry.type === 'gain') {
      lots.push({
        sourceLedgerId: entry.id,
        amount: entry.pointsAmount,
        remaining: entry.pointsAmount,
        expiresAt: addMonths(entry.timestamp, EXPIRY_MONTHS),
      });
      continue;
    }

    // loss e expiration consomem dos lotes mais próximos de vencer.
    let pending = entry.pointsAmount;
    const ordered = [...lots].sort((a, b) => a.expiresAt - b.expiresAt);
    for (const lot of ordered) {
      if (pending === 0) break;
      const take = Math.min(lot.remaining, pending);
      lot.remaining -= take;
      pending -= take;
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pointsBalance: true },
  });
  const balance = user?.pointsBalance ?? 0;
  let sumRemaining = lots.reduce((sum, lot) => sum + lot.remaining, 0);

  // ── Ajuste para fechar o invariante ──────────────────────────────────────
  // 1) Saldo SEM lastro no ledger (fixtures, importações antigas, correções
  //    manuais): vira um lote "legado", sem lançamento de origem.
  // 2) Lotes com MAIS saldo que o real (expirações antigas não registradas):
  //    consome os mais antigos até igualar.
  if (balance > sumRemaining) {
    const legacy = balance - sumRemaining;
    lots.push({
      sourceLedgerId: null,
      amount: legacy,
      remaining: legacy,
      expiresAt: addMonths(new Date(), EXPIRY_MONTHS),
    });
    sumRemaining = balance;
  } else if (balance < sumRemaining) {
    let excess = sumRemaining - balance;
    const ordered = [...lots].sort((a, b) => a.expiresAt - b.expiresAt);
    for (const lot of ordered) {
      if (excess === 0) break;
      const take = Math.min(lot.remaining, excess);
      lot.remaining -= take;
      excess -= take;
    }
    sumRemaining = balance;
  }

  if (sumRemaining !== balance) {
    mismatch += 1;
    console.log(`  ! ${userId}: SUM(remaining)=${sumRemaining} != saldo=${balance}`);
  }

  if (APPLY) {
    await prisma.$transaction(async (tx) => {
      await tx.pointsLot.deleteMany({ where: { userId, tenantId } });
      if (lots.length > 0) {
        await tx.pointsLot.createMany({
          data: lots.map((lot) => ({
            userId,
            tenantId,
            amount: lot.amount,
            remaining: lot.remaining,
            expiresAt: lot.expiresAt,
            sourceLedgerId: lot.sourceLedgerId,
          })),
        });
      }
    });
  }

  usersProcessed += 1;
  lotsCreated += lots.length;
}

console.log(`\nusuários analisados : ${usersProcessed}`);
console.log(`lotes calculados    : ${lotsCreated}`);
console.log(`divergências        : ${mismatch}`);
console.log(APPLY ? 'gravado.' : 'dry-run (use --apply para gravar).');

await prisma.$disconnect();
