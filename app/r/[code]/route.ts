import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  const { code } = params;

  // Look up the short code
  const rows = await db.execute(sql`
    SELECT affiliate_url, creator_id, keyword, platform
    FROM manychat_links
    WHERE code = ${code}
    LIMIT 1
  `);

  const link = (rows as any[])[0];
  if (!link) {
    return NextResponse.redirect("https://creator-metrics.vercel.app");
  }

  // Log the click event (fire and forget — don't block the redirect)
  const subscriberIg = req.nextUrl.searchParams.get("ig") ?? null;
  db.execute(sql`
    INSERT INTO manychat_events (creator_id, event_type, keyword, link_code, subscriber_ig)
    VALUES (${link.creator_id}, 'clicked', ${link.keyword}, ${code}, ${subscriberIg})
  `).catch(() => {});

  return NextResponse.redirect(link.affiliate_url);
}
