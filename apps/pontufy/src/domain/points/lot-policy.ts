// ═══════════════════════════════════════════════════════════════════════════
// A1 — Política de validade dos lotes (módulo PURO)
//
// Separado de `lots.ts` de propósito: `lots.ts` importa o client de banco, e
// importar banco só para calcular uma data arrasta validação de ambiente e
// conexão para dentro de qualquer consumidor (inclusive teste unitário).
// Regra de negócio pura fica aqui; persistência fica em `lots.ts`.
// ═══════════════════════════════════════════════════════════════════════════

/** Validade padrão de um lote, em meses. */
export const LOT_EXPIRY_MONTHS = Number(process.env.POINTS_EXPIRY_MONTHS ?? 12);

/** Data de vencimento de um lote criado em `from`. */
export function lotExpiryDate(from: Date = new Date()): Date {
  const expiresAt = new Date(from);
  expiresAt.setMonth(expiresAt.getMonth() + LOT_EXPIRY_MONTHS);
  return expiresAt;
}
