import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sales, shopmyOpportunityCommissions, shopmyPayments, shopmyBrandRates } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Wipe ShopMy records for a creator so the next sync re-inserts with correct field mappings. */
export async function DELETE(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const creatorId = req.nextUrl.searchParams.get("creatorId") ?? "nicki_entenmann";

  const [deletedSales, deletedOp, deletedPayments, deletedRates] = await Promise.all([
    db.delete(sales).where(and(eq(sales.creatorId, creatorId), eq(sales.platform, "shopmy"))).returning({ id: sales.id }),
    db.delete(shopmyOpportunityCommissions).where(eq(shopmyOpportunityCommissions.creatorId, creatorId)).returning({ id: shopmyOpportunityCommissions.id }),
    db.delete(shopmyPayments).where(eq(shopmyPayments.creatorId, creatorId)).returning({ id: shopmyPayments.id }),
    db.delete(shopmyBrandRates).where(eq(shopmyBrandRates.creatorId, creatorId)).returning({ id: shopmyBrandRates.id }),
  ]);

  return NextResponse.json({
    cleared: {
      sales: deletedSales.length,
      opportunityCommissions: deletedOp.length,
      payments: deletedPayments.length,
      brandRates: deletedRates.length,
    },
  });
}
