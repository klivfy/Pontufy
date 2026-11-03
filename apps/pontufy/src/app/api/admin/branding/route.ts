import { NextResponse } from 'next/server';
import { getSessionContext } from '@/backend/session';
import { getTenantDb } from '@/backend/db';
import { logAudit, extractRequestMeta } from '@/lib/audit';
import { sanitizeHexColor, sanitizeBrandingUrl, DEFAULT_PRIMARY_COLOR, DEFAULT_ACCENT_COLOR } from '@/lib/branding';

const BRANDING_SELECT = {
  name: true,
  logoUrl: true,
  faviconUrl: true,
  primaryColor: true,
  accentColor: true,
  aiCredits: true,
} as const;

// GET é acessível a qualquer utilizador autenticado: o DynamicThemeProvider
// precisa da identidade visual do tenant em todas as rotas.
// Dados de contrato (aiCredits) NÃO são branding e só saem para admin —
// antes o campo era devolvido a qualquer colaborador (V9 do SEGURANCA-ESTRUTURAL.md).
export async function GET() {
  try {
    const { tenantId, role } = await getSessionContext();
    const db = getTenantDb(tenantId);

    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: BRANDING_SELECT,
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant não encontrado.' }, { status: 404 });
    }

    const isAdmin = role === 'admin_rh' || role === 'super_admin';

    return NextResponse.json({
      name: tenant.name,
      logoUrl: tenant.logoUrl ?? null,
      faviconUrl: tenant.faviconUrl ?? null,
      primaryColor: tenant.primaryColor ?? DEFAULT_PRIMARY_COLOR,
      accentColor: tenant.accentColor ?? DEFAULT_ACCENT_COLOR,
      ...(isAdmin ? { aiCredits: tenant.aiCredits } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Não autenticado.') {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    console.error('GET /api/admin/branding:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { tenantId, role, userId } = await getSessionContext();

    if (role !== 'admin_rh') {
      return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const body = await request.json();
    const { logoUrl, faviconUrl, primaryColor, accentColor } = body ?? {};

    // Higienização estrita: cores inválidas (CSS Injection) → 400.
    const sanitizedPrimary = sanitizeHexColor(primaryColor);
    if (primaryColor !== undefined && !sanitizedPrimary) {
      return NextResponse.json(
        { error: 'Cor primária inválida. Use formato #RGB ou #RRGGBB.' },
        { status: 400 },
      );
    }

    const sanitizedAccent = sanitizeHexColor(accentColor);
    if (accentColor !== undefined && !sanitizedAccent) {
      return NextResponse.json(
        { error: 'Cor de destaque inválida. Use formato #RGB ou #RRGGBB.' },
        { status: 400 },
      );
    }

    if (logoUrl !== undefined && logoUrl !== null && sanitizeBrandingUrl(logoUrl) === null) {
      return NextResponse.json(
        { error: 'URL do logo inválida (use https:// ou caminho relativo).' },
        { status: 400 },
      );
    }

    if (faviconUrl !== undefined && faviconUrl !== null && sanitizeBrandingUrl(faviconUrl) === null) {
      return NextResponse.json(
        { error: 'URL do favicon inválida (use https:// ou caminho relativo).' },
        { status: 400 },
      );
    }

    const db = getTenantDb(tenantId);
    const current = await db.tenant.findUnique({
      where: { id: tenantId },
      select: BRANDING_SELECT,
    });
    if (!current) {
      return NextResponse.json({ error: 'Tenant não encontrado.' }, { status: 404 });
    }

    const data: {
      logoUrl?: string | null;
      faviconUrl?: string | null;
      primaryColor?: string | null;
      accentColor?: string | null;
    } = {};

    if (logoUrl !== undefined) data.logoUrl = sanitizeBrandingUrl(logoUrl);
    if (faviconUrl !== undefined) data.faviconUrl = sanitizeBrandingUrl(faviconUrl);
    if (sanitizedPrimary) data.primaryColor = sanitizedPrimary;
    if (sanitizedAccent) data.accentColor = sanitizedAccent;

    const updated = await db.tenant.update({
      where: { id: tenantId },
      data,
      select: BRANDING_SELECT,
    });

    // Auditoria imutável: BRANDING_UPDATED com valores antes/depois.
    const meta = extractRequestMeta(request);
    await logAudit({
      tenantId,
      userId,
      action: 'BRANDING_UPDATED',
      entity: 'Tenant',
      entityId: tenantId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      oldValue: {
        logoUrl: current.logoUrl,
        faviconUrl: current.faviconUrl,
        primaryColor: current.primaryColor,
        accentColor: current.accentColor,
      },
      newValue: {
        logoUrl: updated.logoUrl,
        faviconUrl: updated.faviconUrl,
        primaryColor: updated.primaryColor,
        accentColor: updated.accentColor,
      },
    });

    return NextResponse.json({
      success: true,
      branding: {
        name: updated.name,
        logoUrl: updated.logoUrl ?? null,
        faviconUrl: updated.faviconUrl ?? null,
        primaryColor: updated.primaryColor ?? DEFAULT_PRIMARY_COLOR,
        accentColor: updated.accentColor ?? DEFAULT_ACCENT_COLOR,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Não autenticado.') {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    console.error('PATCH /api/admin/branding:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}