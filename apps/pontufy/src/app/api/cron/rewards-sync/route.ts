import { NextResponse } from 'next/server';
import { getRawPrisma } from '@/infra/platform-db';
import { authorizeCronRequest } from '@/lib/security/cron-auth';

export const dynamic = 'force-dynamic'; // Prevent static caching for cron endpoints

/**
 * Automatic Stock Synchronizer & Catalog Controller
 * Vercel Cron target: /api/cron/rewards-sync
 */
export async function GET(request: Request) {
  try {
    const auth = authorizeCronRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const prisma = getRawPrisma();

    // 2. Fetch all active rewards across the platform
    const activeRewards = await prisma.reward.findMany({
      where: {
        isActive: true
      }
    });

    let syncStats = {
      checked: activeRewards.length,
      deactivated: 0,
      errors: 0
    };

    // 3. Loop and simulate affiliate stock/link check
    for (const reward of activeRewards) {
      try {
        // Use originalUrl for checking (the base URL before tracking)
        const checkUrl = reward.originalUrl;
        const isOutOfStockOrBroken = await simulateAffiliateCheck(checkUrl);

        if (isOutOfStockOrBroken) {
          // Transactional toggle to avoid fulfilling dead redemptions
          await prisma.$transaction(async (tx) => {
            await tx.reward.update({
              where: { id: reward.id },
              data: { isActive: false }
            });
          });
          syncStats.deactivated++;
          console.warn(`[CATALOG SYNC] Recompensa desativada: ${reward.id} - ${reward.title} (Esgotada/Quebrada)`);
        }
      } catch (error) {
         console.error(`[CATALOG SYNC] Erro ao sincronizar recompensa ${reward.id}:`, error);
         syncStats.errors++;
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Sincronização de catálogo concluída.',
      stats: syncStats
    }, { status: 200 });

  } catch (error: any) {
    console.error('[CRON JOB] Erro fatal no rewards-sync:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

/**
 * Mock function to simulate affiliate network API response
 * E.g., calling Lomadee/Amazon to verify 404 or out-of-stock XML tag.
 */
async function simulateAffiliateCheck(url: string): Promise<boolean> {
  // Simulating network latency
  await new Promise((resolve) => setTimeout(resolve, 50));
  
  // In a real scenario:
  // const res = await fetch(url, { method: 'HEAD' });
  // if (res.status === 404) return true;
  
  // Return false (assumes it's always in stock for the MVP simulator)
  return false;
}
