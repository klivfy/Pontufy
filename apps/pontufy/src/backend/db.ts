export { prisma, getTenantDb, databaseUrl, directUrl } from '@/infra/db';

// Acesso sem escopo de tenant é exportado apenas por `@/infra/platform-db`.
// Reexportar aqui (como antes) anulava o efeito do nome hostil.
