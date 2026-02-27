import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { platformEarnings, creators } from "@/lib/schema";
import { getLTKTokens } from "@/lib/ltk";
import { eq, sql } from "drizzle-orm";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Confirmed working endpoints (from ent-dashboard LTK_API.md)
const CREATOR_API = "https://creator-api-gateway.shopltk.com/v1";

const RANGES = [
  { label: "last_7_days", days: 7 },
  { label: "last_30_days", days: 30 },
];

async function ltkCreatorFetch<T>(
  path: string,
  accessToken: string,
  idToken: string
): Promise<T> {
  const res = await fetch(`${CREATOR_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-id-token": idToken,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LTK Creator API ${res.status} ${path}: ${text}`);
  }
  return res.json();
}

/**
 * LTK sync cron — fetches earnings + engagement summaries from the Creator API
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

    const results: { creator: string; status: string; upserted?: number; error?: string }[] = [];

    for (const creator of ltkCreators) {
      if (!creator.ltkPublisherId) {
        results.push({ creator: creator.id, status: "skipped", error: "no ltkPublisherId" });
        continue;
      }

      let upserted = 0;

      try {
        for (const range of RANGES) {
          const [earningsRes, engagementRes] = await Promise.allSettled([
            ltkCreatorFetch<any>(`/earnings/summary?range=${range.label}`, tokens.accessToken, tokens.idToken),
            ltkCreatorFetch<any>(`/engagement/summary?range=${range.label}`, tokens.accessToken, tokens.idToken),
          ]);

          const earnings = earningsRes.status === "fulfilled" ? earningsRes.value : null;
          const engagement = engagementRes.status === "fulfilled" ? engagementRes.value : null;

          if (!earnings && !engagement) continue;

          // Derive commission amount — LTK returns commissions as number or {total, amount}
          const rawCommission = earnings?.commissions;
          const commissionAmount = rawCommission != null
            ? typeof rawCommission === "object"
              ? String(rawCommission?.total ?? rawCommission?.amount ?? 0)
              : String(rawCommission)
            : "0";

          const revenue = engagement?.total_sales != null
            ? String(engagement.total_sales)
            : commissionAmount;

          const clicks = engagement?.product_clicks ?? engagement?.total_visits ?? 0;
          const orders = engagement?.orders ?? 0;

          // Period window
          const periodEnd = new Date();
          const periodStart = new Date();
          periodStart.setDate(periodEnd.getDate() - range.days);

          await db
            .insert(platformEarnings)
            .values({
              creatorId: creator.id,
              platform: "ltk",
              periodStart: periodStart.toISOString().split("T")[0],
              periodEnd: periodEnd.toISOString().split("T")[0],
              revenue,
              commission: commissionAmount,
              clicks,
              orders,
              rawPayload: JSON.stringify({ earnings, engagement }),
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
                commission: commissionAmount,
                clicks,
                orders,
                rawPayload: JSON.stringify({ earnings, engagement }),
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
