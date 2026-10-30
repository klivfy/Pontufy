type Tx = {
  user: {
    findFirst: (args: unknown) => Promise<{ id: string; pointsBalance: number } | null>;
    update: (args: unknown) => Promise<{ id: string; pointsBalance: number }>;
  };
  pointsLedger: { create: (args: unknown) => Promise<unknown> };
};

export class PointsError extends Error {
  constructor(
    message: string,
    public readonly code: 'USER_NOT_FOUND' | 'INSUFFICIENT_BALANCE',
    public readonly missing?: number,
  ) {
    super(message);
    this.name = 'PointsError';
  }
}

export async function creditPoints(
  tx: Tx,
  params: { userId: string; tenantId: string; amount: number; description: string },
) {
  const updatedUser = await tx.user.update({
    where: { id: params.userId },
    data: { pointsBalance: { increment: params.amount } },
  });
  await tx.pointsLedger.create({
    data: {
      userId: params.userId,
      tenantId: params.tenantId,
      type: 'gain',
      pointsAmount: params.amount,
      description: params.description,
    },
  });
  return updatedUser;
}

export async function debitPoints(
  tx: Tx,
  params: { userId: string; tenantId: string; amount: number; description: string },
) {
  const user = await tx.user.findFirst({ where: { id: params.userId } });
  if (!user) throw new PointsError('Usuário não encontrado.', 'USER_NOT_FOUND');
  if (user.pointsBalance < params.amount) {
    throw new PointsError('Saldo insuficiente.', 'INSUFFICIENT_BALANCE', params.amount - user.pointsBalance);
  }
  const updatedUser = await tx.user.update({
    where: { id: params.userId },
    data: { pointsBalance: { decrement: params.amount } },
  });
  await tx.pointsLedger.create({
    data: {
      userId: params.userId,
      tenantId: params.tenantId,
      type: 'loss',
      pointsAmount: params.amount,
      description: params.description,
    },
  });
  return updatedUser;
}
