// File: src/app/api/cron/sync-lomadee/route.ts
// Job de sincronização de catálogo Lomadee
// Executa via Vercel Cron (cron.yaml) ou scheduler externo
// Segurança: Bearer token no header Authorization

import { NextResponse } from 'next/server';
import { getRawPrisma } from '@/backend/db';
import { lomadeeService, LomadeeCoupon, LomadeeOffer } from '@/lib/lomadee';
import { logAudit } from '@/lib/audit';
import { cacheDeletePattern } from '@/lib/redis';

const CRON_SECRET = process.env.CRON_SECRET;

interface SyncResult {
  couponsProcessed: number;
  offersProcessed: number;
  rewardsCreated: number;
  rewardsUpdated: number;
  rewardsDeactivated: number;
  errors: string[];
}

export async function GET(request: Request) {
  return handleSync(request);
}

export async function POST(request: Request) {
  return handleSync(request);
}

async function handleSync(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();

  try {
    const authHeader = request.headers.get('authorization');
    const vercelCronHeader = request.headers.get('x-vercel-cron');
    const isVercelCron = vercelCronHeader === '1';
    const isAuthorized = isVercelCron || (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`);

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Verifica se Lomadee está configurado
    if (!lomadeeService.isConfigured()) {
      return NextResponse.json({
        success: false,
        message: 'Lomadee não configurado (LOMADEE_APP_TOKEN / LOMADEE_SOURCE_ID ausentes)',
      }, { status: 503 });
    }

    const prisma = getRawPrisma();
    const result: SyncResult = {
      couponsProcessed: 0,
      offersProcessed: 0,
      rewardsCreated: 0,
      rewardsUpdated: 0,
      rewardsDeactivated: 0,
      errors: [],
    };

    // Busca catálogo ativo da Lomadee
    const catalog = await lomadeeService.fetchCatalog();

    // Loga diagnóstico das chamadas HTTP para depuração de integração
    if (catalog.diagnostics) {
      const diag = catalog.diagnostics;
      console.log(`Lomadee sync diagnostics: couponsStatus=${diag.couponsStatus} couponsSample=${diag.couponsBodySample}`);
      console.log(`Lomadee sync diagnostics: offersStatus=${diag.offersStatus} offersSample=${diag.offersBodySample}`);
      diag.errors.forEach(err => console.warn(`Lomadee sync diagnostic error: ${err}`));
    }

    // Processa cupons
    for (const coupon of catalog.coupons) {
      try {
        await processCoupon(prisma, coupon, result);
      } catch (error) {
        const errMsg = `Erro ao processar cupom ${coupon.id}: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errMsg);
        console.error(errMsg);
      }
    }

    // Processa ofertas
    for (const offer of catalog.offers) {
      try {
        await processOffer(prisma, offer, result);
      } catch (error) {
        const errMsg = `Erro ao processar oferta ${offer.id}: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errMsg);
        console.error(errMsg);
      }
    }

    // Desativa recompensas Lomadee que não estão mais no catálogo ativo
    const activeExternalIds = [
      ...catalog.coupons.map(c => `coupon:${c.id}`),
      ...catalog.offers.map(o => `offer:${o.id}`),
    ];

    const deactivated = await prisma.reward.updateMany({
      where: {
        partner: 'LOMADEE',
        externalId: { notIn: activeExternalIds },
        isActive: true,
      },
      data: { isActive: false, updatedAt: new Date() },
    });
    result.rewardsDeactivated = deactivated.count;

    // Auditoria
    await logAudit({
      tenantId: 'system',
      userId: 'cron',
      action: 'LOMADEE_CATALOG_SYNC',
      entity: 'Reward',
      newValue: {
        couponsProcessed: result.couponsProcessed,
        offersProcessed: result.offersProcessed,
        rewardsCreated: result.rewardsCreated,
        rewardsUpdated: result.rewardsUpdated,
        rewardsDeactivated: result.rewardsDeactivated,
        durationMs: Date.now() - startedAt,
        errors: result.errors.length,
      },
    });

    // Invalida cache de recompensas de todos os tenants (recompensas são globais)
    await cacheDeletePattern('rewards:*').catch(() => {});

    return NextResponse.json({
      success: true,
      message: 'Sincronização Lomadee concluída',
      result,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('Erro na sincronização Lomadee:', error);
    return NextResponse.json(
      { success: false, error: 'Erro interno na sincronização', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

async function processCoupon(
  prisma: any,
  coupon: LomadeeCoupon,
  result: SyncResult,
): Promise<void> {
  const externalId = `coupon:${coupon.id}`;
  result.couponsProcessed++;

  const existing = await prisma.reward.findFirst({
    where: { partner: 'LOMADEE', externalId },
  });

  const rewardData = {
    title: coupon.title,
    originalUrl: coupon.affiliateLink,
    pricePoints: calculatePointsCost(coupon.discountValue, coupon.discountType),
    imageUrl: coupon.partnerLogo,
    category: coupon.category || 'coupons',
    partner: 'LOMADEE',
    externalId,
    isActive: true,
    affiliateUrl: coupon.affiliateLink, // Será atualizado com tracking no resgate
    updatedAt: new Date(),
  };

  if (existing) {
    await prisma.reward.update({
      where: { id: existing.id },
      data: rewardData,
    });
    result.rewardsUpdated++;
  } else {
    await prisma.reward.create({
      data: {
        tenantId: null, // Global
        ...rewardData,
      },
    });
    result.rewardsCreated++;
  }
}

async function processOffer(
  prisma: any,
  offer: LomadeeOffer,
  result: SyncResult,
): Promise<void> {
  const externalId = `offer:${offer.id}`;
  result.offersProcessed++;

  const existing = await prisma.reward.findFirst({
    where: { partner: 'LOMADEE', externalId },
  });

  // Calcula pontos baseados no desconto/preço promocional
  const pointsCost = calculateOfferPointsCost(offer);

  const rewardData = {
    title: offer.title,
    originalUrl: offer.affiliateLink,
    pricePoints: pointsCost,
    imageUrl: offer.imageUrl || offer.partnerLogo,
    category: offer.category || 'offers',
    partner: 'LOMADEE',
    externalId,
    isActive: true,
    affiliateUrl: offer.affiliateLink,
    updatedAt: new Date(),
  };

  if (existing) {
    await prisma.reward.update({
      where: { id: existing.id },
      data: rewardData,
    });
    result.rewardsUpdated++;
  } else {
    await prisma.reward.create({
      data: {
        tenantId: null, // Global
        ...rewardData,
      },
    });
    result.rewardsCreated++;
  }
}

function calculatePointsCost(discountValue: number, discountType: string): number {
  // Fórmula simples: desconto percentual -> pontos baseados no valor
  // Pode ser ajustado conforme regra de negócio
  if (discountType === 'PERCENTAGE') {
    return Math.max(100, Math.round(discountValue * 10)); // Ex: 10% = 100 pts
  }
  if (discountType === 'FIXED') {
    return Math.max(50, Math.round(discountValue * 5)); // Ex: R$ 20 = 100 pts
  }
  return 200; // Free shipping padrão
}

function calculateOfferPointsCost(offer: LomadeeOffer): number {
  if (offer.originalPrice && offer.promotionalPrice) {
    const discount = offer.originalPrice - offer.promotionalPrice;
    const discountPct = (discount / offer.originalPrice) * 100;
    return Math.max(100, Math.round(discountPct * 10));
  }
  if (offer.promotionalPrice) {
    // Baseado no preço promocional
    return Math.max(100, Math.round(offer.promotionalPrice / 5));
  }
  return 200; // Padrão
}