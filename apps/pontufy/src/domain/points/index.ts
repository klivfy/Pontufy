import type { PrismaClient } from '@prisma/client';

// Superfície mínima do client transacional usada por este módulo. Tipar com o
// PrismaClient real (em vez de `any`/`never`) faz erro de schema — campo
// inexistente num `decrement`, por exemplo — ser pego em compilação.
export type PointsTx = Pick<PrismaClient, 'user' | 'pointsLedger'>;

type Tx = PointsTx;

/**
 * Converte o client transacional do Prisma (que, dentro de `getTenantDb`, é o
 * client estendido) para a superfície tipada usada aqui.
 *
 * Por que existe: o tipo dinâmico que o `$extends` produz não é estruturalmente
 * atribuível a `Pick<PrismaClient, ...>` — os delegates têm assinaturas
 * genéricas diferentes. Antes disso os call sites usavam `tx as never`, que
 * desliga a checagem de TODO o corpo da função. Aqui o cast é feito uma única
 * vez, na borda, e o corpo de `creditPoints`/`debitPoints` volta a ser checado.
 */
export function asPointsTx(tx: unknown): PointsTx {
  return tx as PointsTx;
}

export class PointsError extends Error {
  constructor(
    message: string,
    public readonly code: 'USER_NOT_FOUND' | 'INSUFFICIENT_BALANCE' | 'INVALID_AMOUNT',
    public readonly missing?: number,
  ) {
    super(message);
    this.name = 'PointsError';
  }
}

function assertNonNegativeInteger(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new PointsError('Valor de pontos inválido.', 'INVALID_AMOUNT');
  }
}

async function reloadUser(tx: Tx, userId: string) {
  const user = await tx.user.findFirst({
    where: { id: userId },
    select: { id: true, pointsBalance: true },
  });
  if (!user) throw new PointsError('Usuário não encontrado.', 'USER_NOT_FOUND');
  return user;
}

/**
 * Credita pontos de forma atômica (increment no banco) + lançamento no ledger.
 * O `tenantId` vai no `where` para que a operação nunca atravesse tenants,
 * mesmo se executada fora do interceptor `getTenantDb`.
 */
export async function creditPoints(
  tx: Tx,
  params: { userId: string; tenantId: string; amount: number; description: string },
) {
  assertNonNegativeInteger(params.amount);

  // Aula sem pontos atribuídos: nada a creditar (e nada no ledger).
  if (params.amount === 0) return reloadUser(tx, params.userId);

  const result = await tx.user.updateMany({
    where: { id: params.userId, tenantId: params.tenantId },
    data: { pointsBalance: { increment: params.amount } },
  });

  if (result.count === 0) {
    throw new PointsError('Usuário não encontrado.', 'USER_NOT_FOUND');
  }

  await tx.pointsLedger.create({
    data: {
      userId: params.userId,
      tenantId: params.tenantId,
      type: 'gain',
      pointsAmount: params.amount,
      description: params.description,
    },
  });

  return reloadUser(tx, params.userId);
}

/**
 * Debita pontos com UPDATE CONDICIONAL — a correção não depende de lock.
 *
 * O código anterior fazia `findFirst` → compara saldo → `update(decrement)`
 * dentro de uma transação. Em READ COMMITTED (padrão do Postgres) isso NÃO
 * serializa: duas requisições concorrentes leem 100, ambas passam na checagem
 * e ambas decrementam → saldo negativo. O `updateMany` com `pointsBalance >=
 * amount` no WHERE deixa o próprio banco decidir quem ganha a corrida.
 *
 * A constraint `User_pointsBalance_nonneg` (migração) é a última linha de
 * defesa para qualquer outro caminho que escreva no saldo.
 */
export async function debitPoints(
  tx: Tx,
  params: { userId: string; tenantId: string; amount: number; description: string },
) {
  assertNonNegativeInteger(params.amount);

  // Recompensa gratuita: nada a debitar.
  if (params.amount === 0) return reloadUser(tx, params.userId);

  const result = await tx.user.updateMany({
    where: {
      id: params.userId,
      tenantId: params.tenantId,
      pointsBalance: { gte: params.amount },
    },
    data: { pointsBalance: { decrement: params.amount } },
  });

  if (result.count === 0) {
    // O update condicional não distingue "não existe" de "saldo insuficiente".
    const user = await tx.user.findFirst({
      where: { id: params.userId },
      select: { id: true, pointsBalance: true },
    });

    if (!user) throw new PointsError('Usuário não encontrado.', 'USER_NOT_FOUND');

    throw new PointsError(
      'Saldo insuficiente.',
      'INSUFFICIENT_BALANCE',
      params.amount - user.pointsBalance,
    );
  }

  await tx.pointsLedger.create({
    data: {
      userId: params.userId,
      tenantId: params.tenantId,
      type: 'loss',
      pointsAmount: params.amount,
      description: params.description,
    },
  });

  return reloadUser(tx, params.userId);
}
