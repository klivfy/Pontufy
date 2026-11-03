import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ═══════════════════════════════════════════════════════════════════════════
// V2 — "Zero Trust" deixa de ser convenção
//
// A regra documentada é "nunca use prisma direto para dado de tenant". Ela não
// era verificável: qualquer `prisma.user.findMany()` novo compilava, passava
// no review e vazava dados entre tenants em silêncio.
//
// Esta regra bloqueia `prisma.<modeloDeTenant>.*` em todo `src/`, exceto nos
// arquivos da allowlist abaixo — cada um com motivo legítimo (pré-sessão,
// cron de plataforma, webhook, verificação pública, bootstrap local).
//
// Para adicionar um novo acesso raw: inclua o arquivo na allowlist E
// justifique em `src/infra/platform-db.ts`. O diff do PR vira a decisão.
// ═══════════════════════════════════════════════════════════════════════════

/** Modelos cujo dado pertence a um tenant. `Tenant` fica de fora: lookup global por design. */
const TENANT_MODELS = [
  'user',
  'course',
  'lesson',
  'reward',
  'redemption',
  'invitation',
  'notification',
  'battle',
  'skill',
  'skillNode',
  'userSkillProgress',
  'quizAttempt',
  'pointsLedger',
  'lessonCompletion',
  'issuedCertificate',
  'auditLog',
  'passwordReset',
  'commission',
  'emailVerification',
];

const TENANT_MODEL_SELECTOR = `MemberExpression[object.name='prisma'][property.name=/^(${TENANT_MODELS.join('|')})$/]`;

/**
 * Arquivos autorizados a usar o client global em modelos de tenant.
 * Cada linha corresponde a um fluxo sem sessão de tenant naquele ponto.
 */
const RAW_PRISMA_ALLOWLIST = [
  // pré-sessão: e-mail é a chave, ainda não existe tenant na requisição
  'src/auth.ts',
  'src/infra/session.ts',
  'src/domain/auth/google.ts',
  'src/domain/tenant/provision.ts',
  'src/app/api/auth/register/route.ts',
  'src/app/api/auth/forgot-password/route.ts',
  'src/app/api/invitations/accept/route.ts',
  // rotas administrativas que fazem lookup global de e-mail (unicidade global)
  'src/app/api/admin/users/import/route.ts',
  'src/app/api/admin/users/invite/route.ts',
  'src/app/api/invitations/route.ts',
  // jobs de plataforma: cruzam tenants por definição
  'src/app/api/cron/**/route.ts',
  // webhooks: chegam sem sessão; correlação por trackingSubId
  'src/app/api/webhooks/affiliates/route.ts',
  // domínio de comissão: postback sem sessão
  'src/domain/rewards/index.ts',
  // verificação pública de certificado
  'src/app/verify/**/*.tsx',
  // catálogo global de recompensas (tenantId null)
  'src/lib/cache/rewards.ts',
  // bootstrap local (404 fora de desenvolvimento)
  'src/app/api/setup/seed/route.ts',
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: TENANT_MODEL_SELECTOR,
          message:
            "Dado de tenant só via getTenantDb(tenantId). Se este fluxo não tem sessão de tenant " +
            "(pré-sessão, cron, webhook, bootstrap), adicione o arquivo à RAW_PRISMA_ALLOWLIST em " +
            "eslint.config.mjs e justifique em src/infra/platform-db.ts.",
        },
      ],
    },
  },
  {
    files: RAW_PRISMA_ALLOWLIST,
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;
