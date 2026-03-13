import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { platformEarnings, creators } from "@/lib/schema";
import { eq, isNotNull, and, desc } from "drizzle-orm";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Amazon Associates sync cron.
 *
 * NOTE: Amazon's WAF blocks Vercel datacenter IPs (403). The actual data sync
 * runs on the local Mac via LaunchAgent at 8:30am daily:
 *   ~/creator-metrics/tools/amazon-data-sync.py
 *
 * This route reports the last sync time from the DB and checks credentials.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const amazonCreators = await db
    .select({ id: creators.id })
    .from(creators)
    .where(and(eq(creators.isOwned, true), isNotNull(creators.amazonAssociateTag)));

  const status: { creator: string; lastSync?: string; months?: number }[] = [];

  for (const creator of amazonCreators) {
    const rows = await db
      .select({ syncedAt: platformEarnings.syncedAt, periodStart: platformEarnings.periodStart })
      .from(platformEarnings)
      .where(and(eq(platformEarnings.creatorId, creator.id), eq(platformEarnings.platform, "amazon")))
      .orderBy(desc(platformEarnings.syncedAt))
      .limit(1);

    const countRows = await db
      .select({ id: platformEarnings.id })
      .from(platformEarnings)
      .where(and(eq(platformEarnings.creatorId, creator.id), eq(platformEarnings.platform, "amazon")));

    status.push({
      creator: creator.id,
      lastSync: rows[0]?.syncedAt?.toISOString() ?? "never",
      months: countRows.length,
    });
  }

  return NextResponse.json({
    message: "Amazon sync runs via Mac LaunchAgent (tools/amazon-data-sync.py). This cron reports status only.",
    creators: status,
  });
}
