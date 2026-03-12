import { db } from "./db";
import { creatorIntelligence, creatorSnapshots } from "./schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

export async function getTodayAnalysis(creatorId: string) {
  const today = new Date().toISOString().split("T")[0];
  const [row] = await db
    .select()
    .from(creatorIntelligence)
    .where(
      and(
        eq(creatorIntelligence.creatorId, creatorId),
        eq(creatorIntelligence.generatedAt, today)
      )
    )
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
  const result = since
    ? await db.execute(sql`
        SELECT
          media_product_type AS type,
          ROUND(AVG(reach))  AS avg_reach,
          ROUND(AVG(saves))  AS avg_saves,
          ROUND(AVG(shares)) AS avg_shares
        FROM creator_posts
        WHERE creator_id = ${creatorId} AND posted_at >= ${since}::timestamptz
        GROUP BY media_product_type
        ORDER BY avg_reach DESC NULLS LAST
      `)
    : await db.execute(sql`
        SELECT
          media_product_type AS type,
          ROUND(AVG(reach))  AS avg_reach,
          ROUND(AVG(saves))  AS avg_saves,
          ROUND(AVG(shares)) AS avg_shares
        FROM creator_posts
        WHERE creator_id = ${creatorId}
        GROUP BY media_product_type
        ORDER BY avg_reach DESC NULLS LAST
      `);
  return (Array.from(result) as any[]) as { type: string; avg_reach: number; avg_saves: number; avg_shares: number }[];
}

export async function getTopPosts(creatorId: string, since: string | null, limit = 10) {
  const result = since
    ? await db.execute(sql`
        SELECT post_id, image_url, saves, reach, posted_at
        FROM creator_posts
        WHERE creator_id = ${creatorId} AND posted_at >= ${since}::timestamptz
        ORDER BY saves DESC NULLS LAST
        LIMIT ${limit}
      `)
    : await db.execute(sql`
        SELECT post_id, image_url, saves, reach, posted_at
        FROM creator_posts
        WHERE creator_id = ${creatorId}
        ORDER BY saves DESC NULLS LAST
        LIMIT ${limit}
      `);
  return (Array.from(result) as any[]) as { post_id: string; image_url: string; saves: number; reach: number; posted_at: string }[];
}

export async function getAllCreatorIds(): Promise<string[]> {
  const result = await db.execute(
    sql`SELECT DISTINCT creator_id FROM creator_posts ORDER BY creator_id`
  );
  return (Array.from(result) as any[]).map((r: any) => r.creator_id);
}
