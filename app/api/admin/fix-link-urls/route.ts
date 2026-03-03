import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/fix-link-urls
 *
 * Updates link_url on existing media_snapshots rows by extracting the first
 * affiliate URL from each caption using PostgreSQL regex. Skips rows that
 * already have a link_url set.
 *
 * Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Regex pattern: first affiliate URL from caption
  // Ordered by preference: Mavely → LTK → ShopMy → Amazon
  const affiliatePattern = [
    "https?://mavely\\.app\\.link/[^\\s\"'>)\\]]+",
    "https?://mave\\.ly/[^\\s\"'>)\\]]+",
    "https?://ltk\\.app/[^\\s\"'>)\\]]+",
    "https?://liketoknow\\.it/[^\\s\"'>)\\]]+",
    "https?://www\\.shopmy\\.us/[^\\s\"'>)\\]]+",
    "https?://shop\\.my/[^\\s\"'>)\\]]+",
    "https?://amzn\\.to/[^\\s\"'>)\\]]+",
  ].join("|");

  const result = await db.execute(sql`
    UPDATE media_snapshots
    SET link_url = (regexp_match(caption, ${affiliatePattern}, 'i'))[1]
    WHERE caption IS NOT NULL
      AND link_url IS NULL
      AND caption ~* ${affiliatePattern}
    RETURNING media_ig_id
  `);

  const updated = result.length;

  // Also count how many now match mavely_links
  const matchResult = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM media_snapshots ms
    JOIN mavely_links ml ON ms.link_url = ml.link_url
    WHERE ms.creator_id = 'nicki_entenmann'
  `);

  const matches = Number((matchResult[0] as { count: string }).count);

  return NextResponse.json({ updated, mavelyMatches: matches });
}
