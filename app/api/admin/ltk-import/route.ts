import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ltkPosts } from "@/lib/schema";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/ltk-import
 *
 * Accepts LTK Posts CSV export body (text/plain or text/csv).
 * Upserts into ltk_posts keyed by (creator_id, share_url).
 *
 * Expected CSV columns (LTK Posts export format):
 *   hero_image, date_published, clicks, commissions, orders,
 *   items_sold, order_conversion_rate, items_sold_conversion_rate, share_url
 *
 * Query params:
 *   ?creator=nicki_entenmann  (default)
 *
 * Protected by CRON_SECRET.
 *
 * Example:
 *   curl -X POST \
 *     -H "Authorization: Bearer $CRON_SECRET" \
 *     -H "Content-Type: text/plain" \
 *     --data-binary @LTK-export-Posts.csv \
 *     "https://creator-metrics.vercel.app/api/admin/ltk-import?creator=nicki_entenmann"
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const creatorId = url.searchParams.get("creator") ?? "nicki_entenmann";

  const body = await req.text();
  if (!body.trim()) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV must have header + at least one row" }, { status: 400 });
  }

  // Parse header
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());

  const col = (row: string[], name: string): string => {
    const idx = headers.indexOf(name);
    if (idx === -1) return "";
    const val = row[idx] ?? "";
    return val.replace(/^"|"$/g, "").trim();
  };

  const parseNum = (s: string): number => {
    const n = parseFloat(s.replace(/[$,]/g, ""));
    return isNaN(n) ? 0 : n;
  };

  let upserted = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV split — handles quoted fields with no commas inside
    const row = lines[i].split(",");

    const shareUrl = col(row, "share_url");
    if (!shareUrl || !shareUrl.includes("liketk.it")) {
      skipped++;
      continue;
    }

    const rawDate = col(row, "date_published");
    const datePublished = rawDate ? new Date(rawDate) : null;
    const heroImage = col(row, "hero_image") || null;
    const clicks = Math.round(parseNum(col(row, "clicks")));
    const commissions = parseNum(col(row, "commissions")).toFixed(2);
    const orders = Math.round(parseNum(col(row, "orders")));
    const itemsSold = Math.round(parseNum(col(row, "items_sold")));

    await db
      .insert(ltkPosts)
      .values({
        creatorId,
        shareUrl,
        datePublished: datePublished && !isNaN(datePublished.getTime()) ? datePublished : null,
        heroImage,
        clicks,
        commissions,
        orders,
        itemsSold,
      })
      .onConflictDoUpdate({
        target: [ltkPosts.creatorId, ltkPosts.shareUrl],
        set: {
          clicks,
          commissions,
          orders,
          itemsSold,
          heroImage,
          datePublished: datePublished && !isNaN(datePublished.getTime()) ? datePublished : null,
          syncedAt: new Date(),
        },
      });

    upserted++;
  }

  return NextResponse.json({ creatorId, upserted, skipped, total: lines.length - 1 });
}
