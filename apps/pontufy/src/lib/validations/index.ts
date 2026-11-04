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

/**
 * Identificador opaco de recurso.
 *
 * O modelo usa `@default(uuid())`, mas o id NUNCA precisa ser UUID: para o
 * Prisma é uma string opaca, e a consulta é parametrizada. Exigir `.uuid()`
 * criava um contrato que a aplicação não tem — descoberto quando os fixtures
 * de teste (`lesson-isolation-alpha-001`) passaram a ser rejeitados com 400
 * antes da checagem de tenant, em vez do 404 esperado.
 *
 * O que se mantém: tamanho limitado e charset restrito (sem barras, espaços,
 * aspas ou controle), que é o que protege contra payloads malformados.
 */
const opaqueIdSchema = z
  .string({ message: 'Identificador é obrigatório.' })
  .min(1, 'Identificador não pode ser vazio.')
  .max(64, 'Identificador muito longo.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Identificador inválido.');

export const completeLessonSchema = z.object({
  lessonId: opaqueIdSchema.optional(),
  courseId: opaqueIdSchema.optional(),
  lessonSlug: opaqueIdSchema.optional(),
}).refine((v) => Boolean(v.lessonId ?? v.lessonSlug), {
  message: 'lessonId é obrigatório.',
});

// Resgate de recompensa. O PREÇO nunca vem do cliente: só `rewardId` (o valor
// é lido de Reward.pricePoints no servidor). `productUrl` existe apenas para o
// fluxo "abrir oferta" da vitrine, que NÃO debita pontos.
export const redeemSchema = z
  .object({
    rewardId: opaqueIdSchema.optional(),
    productUrl: z.string().url().max(2048).optional(),
    productTitle: z.string().max(200).optional(),
  })
  .refine((v) => v.rewardId || v.productUrl, {
    message: 'rewardId ou productUrl é obrigatório.',
  });

export const revokeAllSchema = z.object({}).strict();

// Auto-cadastro de empresa (endpoint público). Era validado à mão, sem limite
// de requisições — vetor de spam de trial, poluição de banco e envio de e-mail
// em massa.
export const tenantOnboardingSchema = z.object({
  companyName: z.string({ message: 'Nome da empresa é obrigatório.' }).trim().min(2).max(80),
  sector: z.enum(['tech', 'health', 'retail', 'industry'], {
    message: 'Setor inválido.',
  }),
  adminName: z.string({ message: 'Nome do administrador é obrigatório.' }).trim().min(2).max(120),
  adminEmail: emailSchema,
  adminPassword: passwordSchema,
});

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