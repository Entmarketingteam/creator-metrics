import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sales, platformEarnings, creators } from "@/lib/schema";
import { getLTKTokens, fetchLTKItemsSold } from "@/lib/ltk";
import { eq } from "drizzle-orm";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * LTK enrichment cron — fetches detailed sales data and inserts into sales table.
 * Vercel cron: 6:30am UTC daily.
 * Supplements n8n which captures summaries only.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tokens = await getLTKTokens();

    // Get creators with LTK publisher IDs
    const ltkCreators = await db
      .select({ id: creators.id, ltkPublisherId: creators.ltkPublisherId })
      .from(creators)
      .where(eq(creators.isOwned, true));

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7); // Last 7 days

    const results: { creator: string; status: string; itemsCount?: number; error?: string }[] = [];

    for (const creator of ltkCreators) {
      if (!creator.ltkPublisherId) continue;

      try {
        const response = await fetchLTKItemsSold(
          tokens,
          startDate.toISOString(),
          endDate.toISOString(),
          creator.ltkPublisherId
        );

        const items = response.items || response.data || [];

        for (const item of items) {
          await db
            .insert(sales)
            .values({
              creatorId: creator.id,
              platform: "ltk",
              saleDate: new Date(item.soldAt || item.orderDate || item.createdAt || new Date()),
              productName: item.productTitle || item.name || item.description || null,
              productSku: item.productId || item.sku || null,
              brand: item.retailerName || item.brand || item.merchant || null,
              commissionAmount: String(item.totalCommission || item.commission || item.amount || 0),
              orderValue: String(item.orderTotal || item.orderValue || 0),
              status: (item.status || "open").toLowerCase() as any,
              externalOrderId: item.orderNumber || item.id || null,
            })
            .onConflictDoNothing();
        }

        results.push({ creator: creator.id, status: "ok", itemsCount: items.length });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ creator: creator.id, status: "error", error: msg });
      }
    }

    return NextResponse.json({ synced: new Date().toISOString(), results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
