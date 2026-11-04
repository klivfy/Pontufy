import { getRawPrisma } from '@/infra/platform-db';
import { getTenantDb } from '@/backend/db';
import { logger } from '@/infra/logger';
import type { Prisma } from '@prisma/client';

// Trilha de auditoria IMUTÁVEL (append-only): esta tabela aceita exclusivamente
// inserções. É PROIBIDO implementar update/delete sobre AuditLog — a integridade
// do registro é a base das obrigações SOC2 / LGPD / GDPR.
//
// Toda mutação sensível (admin_rh ou super_admin) DEVE registrar entity,
// entityId e os valores antigo/novo (JSON) para reconstituição forense.

/**
 * B5 — tenant de plataforma.
 *
 * Existe para que evento operacional (cron, provisionamento, ajuste de crédito
 * pelo super_admin) tenha destino explícito, em vez de cair no tenant de um
 * cliente ou não ser gravado. Criado pela migração `20261103060000`.
 */
export const SYSTEM_TENANT_ID = 'tenant-system';

export interface AuditEntry {
  /** Omitir = evento de plataforma (usa `SYSTEM_TENANT_ID`). */
  tenantId?: string | null;
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * B5 — quando `true`, falha ao gravar auditoria INTERROMPE a operação.
   *
   * Usar em ações de conformidade (publicar curso, ajustar crédito, mudar
   * papel): registro perdido ali é falha de controle, não inconveniência.
   * No resto, auditoria continua best-effort e nunca derruba o fluxo.
   */
  critical?: boolean;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  const tenantId = entry.tenantId === null ? null : entry.tenantId ?? SYSTEM_TENANT_ID;

  try {
    // Evento de plataforma não tem sessão de tenant: usa o client de
    // plataforma. Evento de cliente continua passando pelo interceptor, que
    // garante o escopo.
    const db = tenantId === SYSTEM_TENANT_ID && !entry.tenantId ? getRawPrisma() : getTenantDb(tenantId ?? SYSTEM_TENANT_ID);

    await db.auditLog.create({
      data: {
        tenantId,
        userId: entry.userId || null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId || null,
        oldValue: (entry.oldValue ?? undefined) as Prisma.InputJsonValue,
        newValue: (entry.newValue ?? undefined) as Prisma.InputJsonValue,
        ipAddress: entry.ipAddress || null,
        userAgent: entry.userAgent || null,
      },
    });
  } catch (error) {
    if (entry.critical) {
      logger.error('Auditoria CRÍTICA não gravada — operação interrompida', {
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        error: String(error),
      }, 'audit');
      throw error;
    }

    // Auditoria best-effort nunca derruba a operação principal.
    logger.error('Falha ao gravar auditoria', {
      action: entry.action,
      entity: entry.entity,
      error: String(error),
    }, 'audit');
  }
}

export function extractRequestMeta(request: Request) {
  return {
    ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip'),
    userAgent: request.headers.get('user-agent'),
  };
}
