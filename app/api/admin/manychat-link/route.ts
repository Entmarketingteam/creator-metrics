import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";

// POST — create a new short link
// Body: { creatorId, keyword, affiliateUrl, platform? }
// Returns: { code, shortUrl }
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { creatorId, keyword, affiliateUrl, platform } = await req.json();
  if (!creatorId || !keyword || !affiliateUrl) {
    return NextResponse.json({ error: "Missing creatorId, keyword, or affiliateUrl" }, { status: 400 });
  }

  const code = nanoid(8);

  await db.execute(sql`
    INSERT INTO manychat_links (code, creator_id, keyword, affiliate_url, platform)
    VALUES (${code}, ${creatorId}, ${keyword.toUpperCase()}, ${affiliateUrl}, ${platform ?? null})
  `);

  const shortUrl = `https://creator-metrics.vercel.app/r/${code}`;
  return NextResponse.json({ code, shortUrl });
}

// GET — list all short links, optionally filtered by creatorId
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const creatorId = new URL(req.url).searchParams.get("creatorId");

  const rows = await db.execute(sql`
    SELECT
      l.id, l.code, l.creator_id, l.keyword, l.affiliate_url, l.platform, l.created_at,
      COUNT(e.id) FILTER (WHERE e.event_type = 'clicked') AS clicks
    FROM manychat_links l
    LEFT JOIN manychat_events e ON e.link_code = l.code
    ${creatorId ? sql`WHERE l.creator_id = ${creatorId}` : sql``}
    GROUP BY l.id
    ORDER BY l.created_at DESC
  `);

  return NextResponse.json(rows);
}
