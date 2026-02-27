import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { sales, shopmyOpportunityCommissions } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [normalSales, opCommissions] = await Promise.all([
    db
      .select()
      .from(sales)
      .where(and(eq(sales.creatorId, params.id), eq(sales.platform, "shopmy")))
      .orderBy(desc(sales.saleDate))
      .limit(100),
    db
      .select()
      .from(shopmyOpportunityCommissions)
      .where(eq(shopmyOpportunityCommissions.creatorId, params.id))
      .orderBy(desc(shopmyOpportunityCommissions.syncedAt)),
  ]);

  return NextResponse.json({ sales: normalSales, opportunityCommissions: opCommissions });
}
