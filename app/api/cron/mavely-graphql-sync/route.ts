import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { creators, mavelyLinks, mavelyTransactions } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getMavelyToken, fetchLinkMetrics, fetchTransactions } from "@/lib/mavely-graphql";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Mavely GraphQL sync cron
 * Syncs per-affiliate-link metrics + individual transactions.
 * Enables content-to-revenue attribution via link_url matching.
 *
 * Vercel cron: 8:00 UTC daily (after the Airtable-based mavely-sync at 7:30)
 *
 * Env vars required:
 *   MAVELY_EMAIL     — creator's Mavely login email
 *   MAVELY_PASSWORD  — creator's Mavely login password
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = process.env.MAVELY_EMAIL;
  const password = process.env.MAVELY_PASSWORD;
  if (!email || !password) {
    return NextResponse.json(
      { error: "MAVELY_EMAIL / MAVELY_PASSWORD env vars not set" },
      { status: 500 }
    );
  }

  try {
    // Authenticate and get JWT Bearer token
    const token = await getMavelyToken(email, password);

    // Find owned creator with Mavely credentials (typically Nicki)
    const ownedCreators = await db
      .select({ id: creators.id, mavelyCreatorId: creators.mavelyCreatorId })
      .from(creators)
      .where(eq(creators.isOwned, true));

    if (ownedCreators.length === 0) {
      return NextResponse.json({ error: "No owned creators found" }, { status: 404 });
    }

    // Sync the last 90 days of data
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);

    const startStr = startDate.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];

    const results = [];

    for (const creator of ownedCreators) {
      try {
        // Fetch per-link aggregate metrics
        const links = await fetchLinkMetrics(token, startStr, endStr);

        let linksUpserted = 0;
        for (const link of links) {
          await db
            .insert(mavelyLinks)
            .values({
              creatorId: creator.id,
              mavelyLinkId: link.linkId,
              linkUrl: link.linkUrl,
              title: link.title,
              imageUrl: link.imageUrl,
              periodStart: startStr,
              periodEnd: endStr,
              clicks: link.clicks,
              orders: link.orders,
              commission: String(link.commission),
              revenue: String(link.revenue),
              syncedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                mavelyLinks.creatorId,
                mavelyLinks.mavelyLinkId,
                mavelyLinks.periodStart,
                mavelyLinks.periodEnd,
              ],
              set: {
                clicks: link.clicks,
                orders: link.orders,
                commission: String(link.commission),
                revenue: String(link.revenue),
                title: link.title,
                imageUrl: link.imageUrl,
                syncedAt: new Date(),
              },
            });
          linksUpserted++;
        }

        // Fetch individual transactions
        const transactions = await fetchTransactions(token, startStr, endStr);

        let txInserted = 0;
        let txSkipped = 0;
        for (const tx of transactions) {
          try {
            await db
              .insert(mavelyTransactions)
              .values({
                creatorId: creator.id,
                mavelyTransactionId: tx.transactionId,
                mavelyLinkId: tx.linkId,
                linkUrl: tx.linkUrl,
                referrer: tx.referrer,
                commissionAmount: String(tx.commissionAmount),
                orderValue: String(tx.orderValue),
                saleDate: tx.saleDate ? new Date(tx.saleDate) : null,
                status: tx.status,
                syncedAt: new Date(),
              })
              .onConflictDoNothing();
            txInserted++;
          } catch {
            txSkipped++;
          }
        }

        results.push({
          creator: creator.id,
          status: "ok",
          linksUpserted,
          txInserted,
          txSkipped,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ creator: creator.id, status: "error", error: msg });
      }
    }

    return NextResponse.json({ synced: endStr, period: `${startStr} → ${endStr}`, results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
