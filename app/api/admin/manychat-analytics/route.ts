import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const creatorId = new URL(req.url).searchParams.get("creatorId") ?? "nicki_entenmann";

  const rows = await db.execute(sql`
    SELECT
      keyword,
      COUNT(*) FILTER (WHERE event_type = 'triggered') AS triggered,
      COUNT(*) FILTER (WHERE event_type = 'dm_sent')   AS dm_sent,
      COUNT(*) FILTER (WHERE event_type = 'clicked')   AS clicks
    FROM manychat_events
    WHERE creator_id = ${creatorId}
      AND keyword IS NOT NULL
    GROUP BY keyword
    ORDER BY triggered DESC
  `);

  return NextResponse.json(rows);
}
