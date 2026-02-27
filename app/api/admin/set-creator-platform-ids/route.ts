import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { creators } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * One-time admin route to set platform IDs on creator records.
 * Protected by CRON_SECRET. Safe to leave in place.
 * PATCH body: { creatorId: string, shopmyUserId?: string, ltkPublisherId?: string, mavelyCreatorId?: string }
 */
export async function PATCH(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { creatorId, shopmyUserId, ltkPublisherId, mavelyCreatorId } = body;

  if (!creatorId) {
    return NextResponse.json({ error: "creatorId required" }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  if (shopmyUserId) updates.shopmyUserId = shopmyUserId;
  if (ltkPublisherId) updates.ltkPublisherId = ltkPublisherId;
  if (mavelyCreatorId) updates.mavelyCreatorId = mavelyCreatorId;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(creators)
    .set(updates)
    .where(eq(creators.id, creatorId))
    .returning({ id: creators.id, username: creators.username, shopmyUserId: creators.shopmyUserId });

  if (!updated) {
    return NextResponse.json({ error: "Creator not found" }, { status: 404 });
  }

  return NextResponse.json({ updated });
}

/** List all owned creators and their platform IDs */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: creators.id,
      username: creators.username,
      displayName: creators.displayName,
      shopmyUserId: creators.shopmyUserId,
      ltkPublisherId: creators.ltkPublisherId,
      mavelyCreatorId: creators.mavelyCreatorId,
    })
    .from(creators)
    .where(eq(creators.isOwned, true));

  return NextResponse.json(rows);
}
