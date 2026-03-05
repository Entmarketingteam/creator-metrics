import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { platformEarnings, creators } from "@/lib/schema";
import { getLTKTokens, fetchLTKCommissionsSummary, fetchLTKPerformanceStats } from "@/lib/ltk";
import { eq } from "drizzle-orm";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const RANGES = [
  { label: "last_7_days", days: 7 },
  { label: "last_30_days", days: 30 },
];

/**
 * LTK sync cron — fetches earnings + engagement from api-gateway.rewardstyle.com
 * and upserts into platformEarnings.
 * Vercel cron: 6:30am UTC daily.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tokens = await getLTKTokens();

    const ltkCreators = await db
      .select({ id: creators.id, ltkPublisherId: creators.ltkPublisherId })
      .from(creators)
      .where(eq(creators.isOwned, true));

    const results: { creator: string; status: string; upserted?: number; error?: string; debug?: any }[] = [];

    for (const creator of ltkCreators) {
      if (!creator.ltkPublisherId) {
        results.push({ creator: creator.id, status: "skipped", error: "no ltkPublisherId" });
        continue;
      }

      let upserted = 0;

      try {
        for (const range of RANGES) {
          const periodEnd = new Date();
          const periodStart = new Date();
          periodStart.setDate(periodEnd.getDate() - range.days);

          const startDate = periodStart.toISOString().split("T")[0];
          const endDate = periodEnd.toISOString().split("T")[0];

          const [commissionsRes, performanceRes] = await Promise.allSettled([
            fetchLTKCommissionsSummary(tokens),
            fetchLTKPerformanceStats(tokens, startDate, endDate, creator.ltkPublisherId),
          ]);

          const commissionsData = commissionsRes.status === "fulfilled" ? commissionsRes.value : null;
          const performanceData = performanceRes.status === "fulfilled" ? performanceRes.value : null;
          const commissionsErr = commissionsRes.status === "rejected" ? String(commissionsRes.reason) : null;
          const performanceErr = performanceRes.status === "rejected" ? String(performanceRes.reason) : null;

          if (!commissionsData && !performanceData) {
            results.push({
              creator: creator.id,
              status: "api_error",
              error: `${range.label}: commissions=${commissionsErr} performance=${performanceErr}`,
            });
            continue;
          }

          // net_commissions = what was earned in this period window (correct number to display)
          // open_earnings = lifetime pending balance — not period-specific, do not store in commission
          const perf = performanceData?.data;
          const clicks = perf?.clicks ?? 0;
          const orders = perf?.orders ?? 0;
          const revenue = perf?.net_commissions != null
            ? String(perf.net_commissions)
            : String(commissionsData?.commissions_summary?.open_earnings ?? 0);

          await db
            .insert(platformEarnings)
            .values({
              creatorId: creator.id,
              platform: "ltk",
              periodStart: startDate,
              periodEnd: endDate,
              revenue,
              commission: revenue,
              clicks,
              orders,
              rawPayload: JSON.stringify({ commissionsData, performanceData }),
              syncedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                platformEarnings.creatorId,
                platformEarnings.platform,
                platformEarnings.periodStart,
                platformEarnings.periodEnd,
              ],
              set: {
                revenue,
                commission: revenue,
                clicks,
                orders,
                rawPayload: JSON.stringify({ commissionsData, performanceData }),
                syncedAt: new Date(),
              },
            });

          upserted++;
        }

        results.push({ creator: creator.id, status: "ok", upserted });
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
