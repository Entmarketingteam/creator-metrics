import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { platformEarnings } from "@/lib/schema";
import { eq, sql, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const creatorId = searchParams.get("creatorId");
  const days = parseInt(searchParams.get("days") || "30");

  const conditions = [
    sql`${platformEarnings.syncedAt} >= NOW() - MAKE_INTERVAL(days => ${days})`
  ];
  if (creatorId) conditions.push(eq(platformEarnings.creatorId, creatorId));

  const rows = await db
    .select({
      platform: platformEarnings.platform,
      totalRevenue: sql<string>`COALESCE(SUM(CAST(${platformEarnings.revenue} AS FLOAT)), 0)`,
      totalCommission: sql<string>`COALESCE(SUM(CAST(${platformEarnings.commission} AS FLOAT)), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${platformEarnings.clicks}), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${platformEarnings.orders}), 0)`,
    })
    .from(platformEarnings)
    .where(and(...conditions))
    .groupBy(platformEarnings.platform);

  return NextResponse.json(rows);
}
