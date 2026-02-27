import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sales, platformEarnings, shopmyOpportunityCommissions, shopmyPayments, shopmyBrandRates } from "@/lib/schema";
import { eq, and, count, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const creatorId = req.nextUrl.searchParams.get("creatorId") ?? "nicki_entenmann";

  const [normalSales, opCommissions, payments, brandRates, earnings] = await Promise.all([
    db.select().from(sales).where(and(eq(sales.creatorId, creatorId), eq(sales.platform, "shopmy"))).limit(5),
    db.select().from(shopmyOpportunityCommissions).where(eq(shopmyOpportunityCommissions.creatorId, creatorId)).limit(5),
    db.select().from(shopmyPayments).where(eq(shopmyPayments.creatorId, creatorId)).limit(5),
    db.select().from(shopmyBrandRates).where(eq(shopmyBrandRates.creatorId, creatorId)).limit(5),
    db.select({
      totalCommission: sql<number>`COALESCE(SUM(CAST(${sales.commissionAmount} AS FLOAT)), 0)`,
      totalSales: sql<number>`COUNT(*)`,
    }).from(sales).where(and(eq(sales.creatorId, creatorId), eq(sales.platform, "shopmy"))),
  ]);

  return NextResponse.json({
    creatorId,
    counts: {
      normalSales: normalSales.length,
      opportunityCommissions: opCommissions.length,
      payments: payments.length,
      brandRates: brandRates.length,
    },
    totals: earnings[0],
    samples: {
      sales: normalSales,
      opportunityCommissions: opCommissions,
      payments,
      brandRates,
    },
  });
}
