import { db } from "./db";
import { creators, creatorSnapshots, mediaSnapshots } from "./schema";
import { eq, desc, sql, and, inArray } from "drizzle-orm";

export async function getAllCreatorsSummary() {
  const rows = await db
    .select({
      id: creators.id,
      username: creators.username,
      displayName: creators.displayName,
      profilePictureUrl: creators.profilePictureUrl,
      biography: creators.biography,
      isOwned: creators.isOwned,
      followersCount: creatorSnapshots.followersCount,
      followsCount: creatorSnapshots.followsCount,
      mediaCount: creatorSnapshots.mediaCount,
      capturedAt: creatorSnapshots.capturedAt,
    })
    .from(creators)
    .leftJoin(
      creatorSnapshots,
      and(
        eq(creatorSnapshots.creatorId, creators.id),
        eq(
          creatorSnapshots.capturedAt,
          sql`(SELECT MAX(captured_at) FROM creator_snapshots WHERE creator_id = creators.id)`
        )
      )
    )
    .orderBy(desc(creatorSnapshots.followersCount));

  return rows;
}

export async function getCreatorOverview(creatorId: string) {
  const [latest] = await db
    .select()
    .from(creatorSnapshots)
    .where(eq(creatorSnapshots.creatorId, creatorId))
    .orderBy(desc(creatorSnapshots.capturedAt))
    .limit(1);

  const [previous] = await db
    .select()
    .from(creatorSnapshots)
    .where(eq(creatorSnapshots.creatorId, creatorId))
    .orderBy(desc(creatorSnapshots.capturedAt))
    .limit(1)
    .offset(1);

  const [creator] = await db
    .select()
    .from(creators)
    .where(eq(creators.id, creatorId));

  return { creator, latest, previous };
}

export async function getCreatorHistory(creatorId: string, days = 30) {
  return db
    .select({
      capturedAt: creatorSnapshots.capturedAt,
      followersCount: creatorSnapshots.followersCount,
      reach28d: creatorSnapshots.reach28d,
      accountsEngaged28d: creatorSnapshots.accountsEngaged28d,
      totalInteractions28d: creatorSnapshots.totalInteractions28d,
    })
    .from(creatorSnapshots)
    .where(
      and(
        eq(creatorSnapshots.creatorId, creatorId),
        sql`captured_at >= CURRENT_DATE - ${days}`
      )
    )
    .orderBy(creatorSnapshots.capturedAt);
}

export async function getTopPosts(creatorId: string, limit = 10) {
  return db
    .select()
    .from(mediaSnapshots)
    .where(eq(mediaSnapshots.creatorId, creatorId))
    .orderBy(desc(mediaSnapshots.likeCount))
    .limit(limit);
}

export async function getRecentPosts(creatorId: string, limit = 25) {
  return db
    .select()
    .from(mediaSnapshots)
    .where(eq(mediaSnapshots.creatorId, creatorId))
    .orderBy(desc(mediaSnapshots.postedAt))
    .limit(limit);
}

export async function getComparison(creatorIds: string[]) {
  if (creatorIds.length === 0) return [];

  const rows = await db
    .select({
      creatorId: creators.id,
      username: creators.username,
      displayName: creators.displayName,
      followersCount: creatorSnapshots.followersCount,
      mediaCount: creatorSnapshots.mediaCount,
      reach28d: creatorSnapshots.reach28d,
      accountsEngaged28d: creatorSnapshots.accountsEngaged28d,
      totalInteractions28d: creatorSnapshots.totalInteractions28d,
    })
    .from(creators)
    .leftJoin(
      creatorSnapshots,
      and(
        eq(creatorSnapshots.creatorId, creators.id),
        eq(
          creatorSnapshots.capturedAt,
          sql`(SELECT MAX(captured_at) FROM creator_snapshots WHERE creator_id = creators.id)`
        )
      )
    )
    .where(inArray(creators.id, creatorIds));

  return rows;
}

export async function getRecentPostsByViews(creatorId: string, days = 7) {
  return db
    .select()
    .from(mediaSnapshots)
    .where(
      and(
        eq(mediaSnapshots.creatorId, creatorId),
        sql`${mediaSnapshots.postedAt} >= NOW() - INTERVAL '${sql.raw(String(days))} days'`
      )
    )
    .orderBy(desc(mediaSnapshots.reach), desc(mediaSnapshots.likeCount));
}

export async function getAggregateStats() {
  const [stats] = await db
    .select({
      totalCreators: sql<number>`COUNT(DISTINCT ${creators.id})`,
      totalFollowers: sql<number>`COALESCE(SUM(latest.followers_count), 0)`,
    })
    .from(creators)
    .leftJoin(
      sql`(
        SELECT DISTINCT ON (creator_id) *
        FROM creator_snapshots
        ORDER BY creator_id, captured_at DESC
      ) latest`,
      sql`latest.creator_id = ${creators.id}`
    );

  return stats;
}
