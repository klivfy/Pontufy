-- Paleta da marca Pontufy (M3): verde-chumbo como primária e menta como acento.
--
-- A mudança de `lib/branding.ts` cobre quem já existe, mas o provisionamento de
-- um tenant novo não passa cor explícita — ele herda o DEFAULT da coluna. Sem
-- este ALTER, uma empresa criada depois do deploy nasceria com o esmeralda
-- antigo (#10B981) e a tela de marca mostraria uma cor fora do design system.
--
-- Espelha `Tenant.primaryColor` / `Tenant.accentColor` em prisma/schema.prisma.

ALTER TABLE "Tenant" ALTER COLUMN "primaryColor" SET DEFAULT '#495453';
ALTER TABLE "Tenant" ALTER COLUMN "accentColor" SET DEFAULT '#A7E3C1';
