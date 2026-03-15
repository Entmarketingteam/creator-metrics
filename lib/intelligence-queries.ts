import { db } from "./db";
import { creatorIntelligence, creatorSnapshots } from "./schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

export async function getTodayAnalysis(creatorId: string) {
  // Return the most recent analysis (not just today) so data shows even when cron ran yesterday
  const [row] = await db
    .select()
    .from(creatorIntelligence)
    .where(eq(creatorIntelligence.creatorId, creatorId))
    .orderBy(desc(creatorIntelligence.generatedAt))
    .limit(1);
  return row ?? null;
}

export async function getFollowerHistory(creatorId: string, days: number | null) {
  const query = db
    .select({
      date: creatorSnapshots.capturedAt,
      followers: creatorSnapshots.followersCount,
    })
    .from(creatorSnapshots)
    .where(
      days
        ? and(
            eq(creatorSnapshots.creatorId, creatorId),
            gte(
              creatorSnapshots.capturedAt,
              sql`(CURRENT_DATE - ${days} * INTERVAL '1 day')::date`
            )
          )
        : eq(creatorSnapshots.creatorId, creatorId)
    )
    .orderBy(creatorSnapshots.capturedAt);
  return query;
}

export async function getEngagementByType(creatorId: string, since: string | null) {
  const result = await db.execute(sql`
    SELECT
      media_product_type AS type,
      ROUND(AVG(reach))      AS avg_reach,
      ROUND(AVG(saved))      AS avg_saves,
      ROUND(AVG(shares))     AS avg_shares
    FROM (
      SELECT DISTINCT ON (media_ig_id)
        media_product_type, reach, saved, shares, timestamp AS posted_at
      FROM media_snapshots
      WHERE creator_id = ${creatorId}
      ORDER BY media_ig_id, captured_at DESC
    ) p
    ${since ? sql`WHERE posted_at >= ${since}::timestamptz` : sql``}
    GROUP BY media_product_type
    ORDER BY avg_reach DESC NULLS LAST
  `);
  return (Array.from(result) as any[]) as { type: string; avg_reach: number; avg_saves: number; avg_shares: number }[];
}

export async function getTopPosts(creatorId: string, since: string | null, limit = 10) {
  const result = await db.execute(sql`
    SELECT
      media_ig_id                               AS post_id,
      COALESCE(thumbnail_url, media_url)        AS image_url,
      permalink                                 AS post_url,
      saved                                     AS saves,
      reach,
      timestamp                                 AS posted_at
    FROM (
      SELECT DISTINCT ON (media_ig_id)
        media_ig_id, thumbnail_url, media_url, permalink, saved, reach, timestamp, captured_at
      FROM media_snapshots
      WHERE creator_id = ${creatorId}
      ORDER BY media_ig_id, captured_at DESC
    ) p
    ${since ? sql`WHERE posted_at >= ${since}::timestamptz` : sql``}
    ORDER BY saves DESC NULLS LAST
    LIMIT ${limit}
  `);
  return (Array.from(result) as any[]) as { post_id: string; image_url: string; saves: number; reach: number; posted_at: string }[];
}

export async function getAllCreatorIds(): Promise<string[]> {
  const result = await db.execute(
    sql`SELECT DISTINCT creator_id FROM media_snapshots ORDER BY creator_id`
  );
  return (Array.from(result) as any[]).map((r: any) => r.creator_id);
}
