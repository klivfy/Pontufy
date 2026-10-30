import { NextResponse } from 'next/server';
import { getSessionContext } from '@/infra/session';
import { jsonError } from '@/domain/auth';
import { getStreak, getUserStats, getUnlockedAchievements, getXpLeaderboard } from '@/domain/engagement';
import { logger } from '@/infra/logger';

export async function GET() {
  try {
    const { tenantId, userId } = await getSessionContext();
    const [streak, stats, achievements, leaderboard] = await Promise.all([
      getStreak(userId, tenantId),
      getUserStats(userId, tenantId),
      getUnlockedAchievements(userId, tenantId),
      getXpLeaderboard(tenantId, userId),
    ]);

    return NextResponse.json({
      success: true,
      streak,
      stats,
      achievements: achievements.map((a) => a.id),
      ranking: leaderboard.ranking,
      myRank: leaderboard.myRank,
    });
  } catch (error) {
    const mapped = jsonError(error);
    if (mapped.status >= 500) logger.error('GET /api/gamification', { error: String(error) }, 'engagement');
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
