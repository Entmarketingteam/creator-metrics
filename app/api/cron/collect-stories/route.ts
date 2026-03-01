import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { creators, mediaSnapshots } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const API_BASE = "https://graph.facebook.com/v21.0";

async function igFetch<T>(path: string, token: string): Promise<T> {
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${token}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`IG API ${res.status}: ${err}`);
  }
  return res.json();
}

/**
 * Collect active Stories for owned creators.
 * Stories expire after 24h — run via Vercel cron every 6h.
 *
 * Available story insights: reach, replies, navigation, views
 * (impressions and saved not supported in v21+ for stories)
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "META_ACCESS_TOKEN not set" }, { status: 500 });
  }

  const today = new Date().toISOString().split("T")[0];
  const results: { creator: string; status: string; stories?: number; error?: string }[] = [];

  // Only owned creators have stories API access
  const ownedCreators = await db
    .select({ id: creators.id, igUserId: creators.igUserId })
    .from(creators)
    .where(eq(creators.isOwned, true));

  for (const creator of ownedCreators) {
    if (!creator.igUserId) {
      results.push({ creator: creator.id, status: "skipped", error: "no igUserId" });
      continue;
    }

    try {
      const res = await igFetch<{
        data: {
          id: string;
          caption?: string;
          media_type?: string;
          media_url?: string;
          thumbnail_url?: string;
          timestamp?: string;
        }[];
      }>(
        `/${creator.igUserId}/stories?fields=id,caption,media_type,media_url,thumbnail_url,timestamp`,
        token
      );

      const stories = res.data ?? [];
      let upserted = 0;

      for (const story of stories) {
        // Fetch story insights
        let reach: number | null = null;
        let replies: number | null = null;
        let navigation: number | null = null;
        let views: number | null = null;

        try {
          const insights = await igFetch<{
            data: { name: string; values: { value: number }[] }[];
          }>(`/${story.id}/insights?metric=reach,replies,navigation,views`, token);

          for (const m of insights.data) {
            const val = m.values[0]?.value ?? null;
            if (m.name === "reach") reach = val;
            else if (m.name === "replies") replies = val;
            else if (m.name === "navigation") navigation = val;
            else if (m.name === "views") views = val;
          }
        } catch {
          // insights may fail for very recent stories — still upsert the media
        }

        await db
          .insert(mediaSnapshots)
          .values({
            creatorId: creator.id,
            mediaIgId: story.id,
            capturedAt: today,
            mediaType: story.media_type ?? null,
            mediaProductType: "STORY",
            caption: story.caption ?? null,
            permalink: null,
            mediaUrl: story.media_url ?? null,
            thumbnailUrl: story.thumbnail_url ?? null,
            postedAt: story.timestamp ? new Date(story.timestamp) : null,
            // Stories don't have likes/comments — use reach/views/shares for key signals
            reach: reach,
            shares: navigation,       // navigation = taps forward/back/exits combined
            totalInteractions: replies,
          })
          .onConflictDoUpdate({
            target: [mediaSnapshots.mediaIgId, mediaSnapshots.capturedAt],
            set: {
              reach: reach,
              shares: navigation,
              totalInteractions: replies,
              mediaUrl: story.media_url ?? null,
            },
          });

        upserted++;
      }

      results.push({ creator: creator.id, status: "ok", stories: upserted });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ creator: creator.id, status: "error", error: msg });
    }
  }

  return NextResponse.json({ collected: today, results });
}
