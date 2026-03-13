import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { detectPlatform, detectManyChat } from "@/lib/attribution";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 29 * 86400000).toISOString().split("T")[0];
  const startDate = searchParams.get("startDate") ?? thirtyDaysAgo;
  const endDate = searchParams.get("endDate") ?? today;
  const type = searchParams.get("type"); // "reel" | "image" | "story" | null
  const platform = searchParams.get("platform"); // "mavely" | "ltk" | "manychat" | etc | null
  const creatorId = params.id;

  const mediaRows = await db.execute(sql`
    SELECT DISTINCT ON (media_ig_id)
      media_ig_id,
      "timestamp" AS posted_at,
      media_type,
      media_url,
      thumbnail_url,
      permalink,
      link_url,
      caption,
      like_count,
      comments_count,
      reach,
      saved,
      shares
    FROM media_snapshots
    WHERE creator_id = ${creatorId}
      AND "timestamp" >= ${startDate}::timestamptz
      AND "timestamp" <= (${endDate}::date + interval '1 day')::timestamptz
    ORDER BY media_ig_id, captured_at DESC
    LIMIT 100
  `);

  const posts = await Promise.all(
    (mediaRows as any[]).map(async (row) => {
      const detectedPlatform = detectPlatform(row.link_url ?? row.permalink);
      const manychatKeyword = detectManyChat(row.caption);

      // Platform filter
      if (platform === "manychat" && !manychatKeyword) return null;
      if (platform && platform !== "has-link" && platform !== "manychat" && detectedPlatform !== platform) return null;
      if (platform === "has-link" && !detectedPlatform) return null;

      // Type filter
      const postType = String(row.media_type ?? "image").toLowerCase();
      if (type && !postType.includes(type)) return null;

      // Attributed revenue (Mavely + LTK only — ShopMy/Amazon match by date range, not URL)
      let attributedRevenue: number | null = null;
      let orders: number | null = null;

      if (detectedPlatform === "mavely" && row.permalink) {
        const revenueRow = await db.execute(sql`
          SELECT COALESCE(SUM(commission_amount), 0) AS revenue,
                 COUNT(*) AS orders
          FROM mavely_transactions
          WHERE creator_id = ${creatorId}
            AND referrer ILIKE ${"%" + row.permalink + "%"}
            AND sale_date >= ${startDate}::timestamptz
            AND sale_date <= (${endDate}::date + interval '1 day')::timestamptz
        `);
        const r = (revenueRow as any[])[0];
        if (r) {
          attributedRevenue = Number(r.revenue);
          orders = Number(r.orders);
        }
      }

      if (detectedPlatform === "ltk" && row.permalink) {
        const revenueRow = await db.execute(sql`
          SELECT COALESCE(SUM(commissions), 0) AS revenue,
                 COALESCE(SUM(orders), 0) AS orders
          FROM ltk_posts
          WHERE creator_id = ${creatorId}
            AND share_url = ${row.permalink}
            AND date_published >= ${startDate}::timestamptz
            AND date_published <= (${endDate}::date + interval '1 day')::timestamptz
        `);
        const r = (revenueRow as any[])[0];
        if (r) {
          attributedRevenue = Number(r.revenue);
          orders = Number(r.orders);
        }
      }

      return {
        mediaIgId: row.media_ig_id,
        postedAt: row.posted_at,
        type: postType,
        thumbnailUrl: row.thumbnail_url ?? row.media_url ?? null,
        linkUrl: row.link_url ?? row.permalink ?? null,
        platform: detectedPlatform,
        manychatKeyword,
        reach: Number(row.reach ?? 0),
        likes: Number(row.like_count ?? 0),
        comments: Number(row.comments_count ?? 0),
        saves: Number(row.saved ?? 0),
        shares: Number(row.shares ?? 0),
        attributedRevenue,
        orders,
      };
    })
  );

  return NextResponse.json(posts.filter(Boolean));
}
