import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mediaSnapshots } from "@/lib/schema";
import { sql, isNull, eq, and } from "drizzle-orm";
import { fetchCarouselFirstChildUrl } from "@/lib/instagram";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Backfill media_url for CAROUSEL_ALBUM posts missing both thumbnail_url and media_url.
 * The IG API doesn't return a top-level image for carousels — we fetch the first child.
 *
 * GET /api/admin/backfill-carousel-thumbs
 *   ?dry_run=1  — count only, no writes
 *
 * Auth: Bearer CRON_SECRET (same as crons)
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  const token = process.env.META_ACCESS_TOKEN!;

  // Find all unique carousel media_ig_ids missing images
  // Use the most recent snapshot per media_ig_id
  const missing = await db.execute(sql`
    SELECT DISTINCT ON (media_ig_id)
      media_ig_id
    FROM media_snapshots
    WHERE media_type = 'CAROUSEL_ALBUM'
      AND media_url IS NULL
      AND thumbnail_url IS NULL
    ORDER BY media_ig_id, captured_at DESC
  `);

  const ids = (missing as any[]).map((r) => String(r.media_ig_id));

  if (dryRun) {
    return NextResponse.json({ dryRun: true, carouselsMissingImages: ids.length, ids });
  }

  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const mediaIgId of ids) {
    try {
      const childUrl = await fetchCarouselFirstChildUrl(mediaIgId, token);
      if (!childUrl) {
        failed++;
        errors.push(`${mediaIgId}: no child URL returned`);
        continue;
      }

      // Update all snapshot rows for this media_ig_id
      await db
        .update(mediaSnapshots)
        .set({ mediaUrl: childUrl })
        .where(
          and(
            eq(mediaSnapshots.mediaIgId, mediaIgId),
            isNull(mediaSnapshots.mediaUrl),
            isNull(mediaSnapshots.thumbnailUrl)
          )
        );

      updated++;
    } catch (e) {
      failed++;
      errors.push(`${mediaIgId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    total: ids.length,
    updated,
    failed,
    errors: errors.slice(0, 20),
  });
}
