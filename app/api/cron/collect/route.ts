import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { creators, creatorSnapshots, mediaSnapshots } from "@/lib/schema";
import { CREATORS } from "@/lib/creators";
import { eq } from "drizzle-orm";
import {
  fetchOwnedProfile,
  fetchOwnedMedia,
  fetchOwnedMediaInsights,
  fetchOwnedAccountInsights,
  fetchPublicProfile,
} from "@/lib/instagram";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.META_ACCESS_TOKEN!;
  const ourIgId = process.env.META_IG_BUSINESS_ACCOUNT_ID!;
  const today = new Date().toISOString().split("T")[0];
  const results: { creator: string; status: string; error?: string }[] = [];

  for (const creator of CREATORS) {
    try {
      // Upsert creator record
      await db
        .insert(creators)
        .values({
          id: creator.id,
          igUserId: creator.igUserId ?? "",
          username: creator.username,
          displayName: creator.displayName,
          isOwned: creator.isOwned,
        })
        .onConflictDoNothing();

      if (creator.isOwned && creator.igUserId) {
        const [profile, media, accountInsights] = await Promise.all([
          fetchOwnedProfile(creator.igUserId, token),
          fetchOwnedMedia(creator.igUserId, token),
          fetchOwnedAccountInsights(creator.igUserId, token),
        ]);

        // Update creator with profile pic and bio
        await db
          .update(creators)
          .set({
            profilePictureUrl: profile.profile_picture_url ?? null,
            biography: profile.biography ?? null,
            displayName: profile.name ?? creator.displayName,
          })
          .where(eq(creators.id, creator.id));

        await db
          .insert(creatorSnapshots)
          .values({
            creatorId: creator.id,
            capturedAt: today,
            followersCount: profile.followers_count,
            followsCount: profile.follows_count,
            mediaCount: profile.media_count,
            reach28d: accountInsights.reach ?? null,
            accountsEngaged28d: accountInsights.accounts_engaged ?? null,
            totalInteractions28d: accountInsights.total_interactions ?? null,
            followsUnfollows28d: accountInsights.follows_and_unfollows ?? null,
          })
          .onConflictDoNothing();

        for (const m of media) {
          const insights = await fetchOwnedMediaInsights(m.id, token);
          await db
            .insert(mediaSnapshots)
            .values({
              creatorId: creator.id,
              mediaIgId: m.id,
              capturedAt: today,
              mediaType: m.media_type ?? null,
              mediaProductType: m.media_product_type ?? null,
              caption: m.caption ?? null,
              permalink: m.permalink ?? null,
              mediaUrl: m.media_url ?? null,
              thumbnailUrl: m.thumbnail_url ?? null,
              postedAt: m.timestamp ? new Date(m.timestamp) : null,
              likeCount: m.like_count ?? null,
              commentsCount: m.comments_count ?? null,
              reach: insights.reach ?? null,
              saved: insights.saved ?? null,
              shares: insights.shares ?? null,
              totalInteractions: insights.total_interactions ?? null,
            })
            .onConflictDoUpdate({
              target: [mediaSnapshots.mediaIgId, mediaSnapshots.capturedAt],
              set: {
                mediaUrl: m.media_url ?? null,
                thumbnailUrl: m.thumbnail_url ?? null,
                likeCount: m.like_count ?? null,
                commentsCount: m.comments_count ?? null,
                reach: insights.reach ?? null,
                saved: insights.saved ?? null,
                shares: insights.shares ?? null,
                totalInteractions: insights.total_interactions ?? null,
              },
            });
        }

        results.push({ creator: creator.id, status: "ok" });
      } else {
        const { profile, media } = await fetchPublicProfile(
          ourIgId,
          creator.username,
          token
        );

        await db
          .update(creators)
          .set({
            profilePictureUrl: profile.profile_picture_url ?? null,
            biography: profile.biography ?? null,
            displayName: profile.name ?? creator.displayName,
          })
          .where(eq(creators.id, creator.id));

        await db
          .insert(creatorSnapshots)
          .values({
            creatorId: creator.id,
            capturedAt: today,
            followersCount: profile.followers_count,
            followsCount: null,
            mediaCount: profile.media_count,
          })
          .onConflictDoNothing();

        for (const m of media) {
          await db
            .insert(mediaSnapshots)
            .values({
              creatorId: creator.id,
              mediaIgId: m.id,
              capturedAt: today,
              mediaType: m.media_type ?? null,
              caption: m.caption ?? null,
              permalink: m.permalink ?? null,
              mediaUrl: m.media_url ?? null,
              thumbnailUrl: m.thumbnail_url ?? null,
              postedAt: m.timestamp ? new Date(m.timestamp) : null,
              likeCount: m.like_count ?? null,
              commentsCount: m.comments_count ?? null,
            })
            .onConflictDoUpdate({
              target: [mediaSnapshots.mediaIgId, mediaSnapshots.capturedAt],
              set: {
                mediaUrl: m.media_url ?? null,
                thumbnailUrl: m.thumbnail_url ?? null,
                likeCount: m.like_count ?? null,
                commentsCount: m.comments_count ?? null,
              },
            });
        }

        results.push({ creator: creator.id, status: "ok (public)" });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ creator: creator.id, status: "error", error: msg });
    }
  }

  return NextResponse.json({ collected: today, results });
}
