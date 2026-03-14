import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// ManyChat External Request sends to this endpoint when a comment trigger fires.
// Expected payload (configured in ManyChat flow):
// {
//   "event_type": "triggered" | "dm_sent",
//   "creator_id": "nicki_entenmann",
//   "keyword": "SHOP",
//   "flow_name": "Comment SHOP Flow",
//   "subscriber_ig": "{{instagram username}}",
//   "subscriber_id": "{{subscriber id}}"
// }

export async function POST(req: NextRequest) {
  // Verify shared secret to prevent abuse
  const secret = req.headers.get("x-manychat-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    event_type = "triggered",
    creator_id,
    keyword,
    flow_name,
    subscriber_ig,
    subscriber_id,
  } = body;

  if (!creator_id) {
    return NextResponse.json({ error: "Missing creator_id" }, { status: 400 });
  }

  await db.execute(sql`
    INSERT INTO manychat_events (creator_id, event_type, keyword, flow_name, subscriber_ig, subscriber_id)
    VALUES (${creator_id}, ${event_type}, ${keyword ?? null}, ${flow_name ?? null}, ${subscriber_ig ?? null}, ${subscriber_id ?? null})
  `);

  return NextResponse.json({ ok: true });
}
