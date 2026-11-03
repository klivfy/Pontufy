import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// Schemas Zod centralizados (TAREFA 8.1) — fonte única de validação para
// endpoints e Server Actions. Zod v4 (zod@^4.4.3).
// ═══════════════════════════════════════════════════════════════════════════

export const emailSchema = z
  .string({ message: 'Email é obrigatório.' })
  .trim()
  .toLowerCase()
  .email({ message: 'Email inválido.' })
  .max(190, { message: 'Email muito longo.' });

export const passwordSchema = z
  .string({ message: 'Senha é obrigatória.' })
  .min(8, { message: 'A senha deve ter pelo menos 8 caracteres.' })
  .max(128, { message: 'A senha deve ter no máximo 128 caracteres.' })
  // Rejeita NUL e caracteres de controle (defesa contra protocol smuggling)
  .regex(/^[\x20-\x7E\x80-\xFF]+$/, { message: 'Senha contém caracteres inválidos.' });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ message: 'Senha é obrigatória.' }).max(128),
});

export const registerSchema = z.object({
  token: z.string({ message: 'Token é obrigatório.' }).min(16).max(512),
  name: z
    .string({ message: 'Nome é obrigatório.' })
    .trim()
    .min(2, { message: 'Nome deve ter pelo menos 2 caracteres.' })
    .max(120)
    // Nome não pode carregar markup/scripts (XSS em tela)
    .regex(/^[^<>{}]+$/, { message: 'Nome contém caracteres inválidos.' }),
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(512),
  newPassword: passwordSchema,
});

export const unlockSchema = z.object({ token: z.string().min(16).max(512) });

export const completeLessonSchema = z.object({
  lessonId: z.string({ message: 'lessonId é obrigatório.' }).uuid({ message: 'lessonId inválido.' }),
});

// Resgate de recompensa. O PREÇO nunca vem do cliente: só `rewardId` (o valor
// é lido de Reward.pricePoints no servidor). `productUrl` existe apenas para o
// fluxo "abrir oferta" da vitrine, que NÃO debita pontos.
export const redeemSchema = z
  .object({
    rewardId: z.string().uuid().optional(),
    productUrl: z.string().url().max(2048).optional(),
    productTitle: z.string().max(200).optional(),
  })
  .refine((v) => v.rewardId || v.productUrl, {
    message: 'rewardId ou productUrl é obrigatório.',
  });

export const revokeAllSchema = z.object({}).strict();

// ── Helpers de parse com erro amigável ──────────────────────────────────────

export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): { data: z.infer<T>; error: string | null } {
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    return { data: undefined as z.infer<T>, error: first?.message ?? 'Dados inválidos.' };
  }
  return { data: result.data, error: null };
}