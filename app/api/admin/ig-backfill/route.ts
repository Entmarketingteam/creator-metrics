import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { creators, mediaSnapshots } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const maxDuration = 300;
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

async function fetchMediaInsights(
  mediaId: string,
  mediaProductType: string,
  token: string
): Promise<{
  reach?: number;
  saved?: number;
  shares?: number;
  total_interactions?: number;
  ig_reels_avg_watch_time?: number;
  ig_reels_video_view_total_time?: number;
  views?: number;
}> {
  try {
    const isReel = mediaProductType === "REELS";
    const metrics = isReel
      ? "reach,saved,shares,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time,views"
      : "reach,saved,shares,total_interactions";

    const res = await igFetch<{
      data: { name: string; values: { value: number }[] }[];
    }>(`/${mediaId}/insights?metric=${metrics}`, token);

    const out: Record<string, number> = {};
    for (const m of res.data) {
      out[m.name] = m.values[0]?.value ?? 0;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * GET /api/admin/ig-backfill?creator=nicki_entenmann&limit=500
 *
 * Paginates through ALL historical Instagram media for a creator,
 * upserts into media_snapshots with full insights.
 * Protected by CRON_SECRET.
 * Set limit=-1 to fetch all media (up to 1940 for Nicki).
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

  const url = new URL(req.url);
  const creatorParam = url.searchParams.get("creator") ?? "nicki_entenmann";
  const limitParam = parseInt(url.searchParams.get("limit") ?? "200");
  const pageSize = 50; // IG max per page

  // Get creator record
  const [creator] = await db
    .select({ id: creators.id, igUserId: creators.igUserId })
    .from(creators)
    .where(eq(creators.id, creatorParam));

  if (!creator?.igUserId) {
    return NextResponse.json({ error: `Creator ${creatorParam} not found or no igUserId` }, { status: 404 });
  }

  const today = new Date().toISOString().split("T")[0];
  let upserted = 0;
  let skipped = 0;
  let cursor: string | null = null;
  let fetched = 0;

  const mediaFields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,like_count,comments_count,permalink,timestamp";

  while (true) {
    const cursorParam = cursor ? `&after=${cursor}` : "";
    const page = await igFetch<{
      data: {
        id: string;
        caption?: string;
        media_type?: string;
        media_product_type?: string;
        media_url?: string;
        thumbnail_url?: string;
        like_count?: number;
        comments_count?: number;
        permalink?: string;
        timestamp?: string;
      }[];
      paging?: { cursors?: { after?: string }; next?: string };
    }>(
      `/${creator.igUserId}/media?fields=${mediaFields}&limit=${pageSize}${cursorParam}`,
      token
    );

    if (!page.data?.length) break;

    for (const media of page.data) {
      if (limitParam > 0 && fetched >= limitParam) break;
      fetched++;

      const insights = await fetchMediaInsights(
        media.id,
        media.media_product_type ?? "",
        token
      );

      await db
        .insert(mediaSnapshots)
        .values({
          creatorId: creator.id,
          mediaIgId: media.id,
          capturedAt: today,
          mediaType: media.media_type ?? null,
          mediaProductType: media.media_product_type ?? null,
          caption: media.caption ?? null,
          permalink: media.permalink ?? null,
          mediaUrl: media.media_url ?? null,
          thumbnailUrl: media.thumbnail_url ?? null,
          postedAt: media.timestamp ? new Date(media.timestamp) : null,
          likeCount: media.like_count ?? null,
          commentsCount: media.comments_count ?? null,
          reach: insights.reach ?? null,
          saved: insights.saved ?? null,
          shares: insights.shares ?? null,
          totalInteractions: insights.total_interactions ?? null,
          reelsAvgWatchTimeMs: insights.ig_reels_avg_watch_time ?? null,
          reelsVideoViewTotalTimeMs: insights.ig_reels_video_view_total_time ?? null,
          viewsCount: insights.views ?? null,
        })
        .onConflictDoUpdate({
          target: [mediaSnapshots.mediaIgId, mediaSnapshots.capturedAt],
          set: {
            likeCount: media.like_count ?? null,
            commentsCount: media.comments_count ?? null,
            reach: insights.reach ?? null,
            saved: insights.saved ?? null,
            shares: insights.shares ?? null,
            totalInteractions: insights.total_interactions ?? null,
            reelsAvgWatchTimeMs: insights.ig_reels_avg_watch_time ?? null,
            reelsVideoViewTotalTimeMs: insights.ig_reels_video_view_total_time ?? null,
            viewsCount: insights.views ?? null,
            mediaUrl: media.media_url ?? null,
            thumbnailUrl: media.thumbnail_url ?? null,
          },
        });

      upserted++;
    }

    // Check if we've hit the limit or run out of pages
    const done = (limitParam > 0 && fetched >= limitParam) || !page.paging?.next;
    if (done) break;

    cursor = page.paging?.cursors?.after ?? null;
    if (!cursor) break;

    // Small delay to avoid rate limits when fetching many pages
    await new Promise((r) => setTimeout(r, 200));
  }

  return NextResponse.json({
    creator: creatorParam,
    upserted,
    skipped,
    totalFetched: fetched,
  });
}
