import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  sales,
  platformEarnings,
  creators,
  shopmyPayments,
  shopmyBrandRates,
} from "@/lib/schema";
import {
  loginShopMy,
  fetchPayoutSummary,
  fetchPayments,
  fetchBrandRates,
  parseShopMyAmount,
} from "@/lib/shopmy";
import { eq, isNotNull, and } from "drizzle-orm";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function mapShopMyStatus(commission: any): "open" | "pending" | "paid" | "reversed" {
  if (commission.isPaid) return "paid";
  const s = (commission.statusDisplay ?? commission.status ?? "").toLowerCase();
  if (s.includes("paid")) return "paid";
  if (s.includes("pending") || s.includes("processing")) return "pending";
  if (s.includes("reversed") || s.includes("cancel")) return "reversed";
  return "open";
}

/**
 * ShopMy sync cron — authenticates, fetches payout data, upserts to DB.
 * Vercel cron: 7am UTC daily.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch all owned creators with a ShopMy user ID
  const shopmyCreators = await db
    .select({
      id: creators.id,
      shopmyUserId: creators.shopmyUserId,
    })
    .from(creators)
    .where(and(eq(creators.isOwned, true), isNotNull(creators.shopmyUserId)));

  if (shopmyCreators.length === 0) {
    return NextResponse.json({ synced: 0, message: "No creators with shopmyUserId" });
  }

  // Credentials — one set per creator env var pattern
  // SHOPMY_NICKI_EMAIL / SHOPMY_NICKI_PASSWORD, etc.
  // Map creatorId → credential env prefix (extend as more creators are added)
  const creatorCredMap: Record<string, string> = {
    nicki: "SHOPMY_NICKI",
    // sara: "SHOPMY_SARA",
    // ellen: "SHOPMY_ELLEN",
  };

  const results: { creator: string; status: string; error?: string }[] = [];

  for (const creator of shopmyCreators) {
    if (!creator.shopmyUserId) continue;

    // Find env prefix by matching creator id substring (case-insensitive)
    const envPrefix =
      Object.entries(creatorCredMap).find(([key]) =>
        creator.id.toLowerCase().includes(key)
      )?.[1] ?? null;

    if (!envPrefix) {
      results.push({
        creator: creator.id,
        status: "skipped",
        error: "No credential env prefix mapped for this creator",
      });
      continue;
    }

    const email = process.env[`${envPrefix}_EMAIL`];
    const password = process.env[`${envPrefix}_PASSWORD`];

    if (!email || !password) {
      results.push({
        creator: creator.id,
        status: "skipped",
        error: `Missing env vars: ${envPrefix}_EMAIL / ${envPrefix}_PASSWORD`,
      });
      continue;
    }

    try {
      const session = await loginShopMy(email, password);
      const [summary, payments, brandRates] = await Promise.all([
        fetchPayoutSummary(session, creator.shopmyUserId),
        fetchPayments(session, creator.shopmyUserId).catch((e) => {
          console.warn(`[shopmy-sync] payments fetch failed for ${creator.id}: ${e.message}`);
          return [] as any[];
        }),
        fetchBrandRates(session, creator.shopmyUserId).catch((e) => {
          console.warn(`[shopmy-sync] brand rates fetch failed for ${creator.id}: ${e.message}`);
          return [] as any[];
        }),
      ]);

      // --- Upsert payouts (individual commissions) → sales table ---
      // API returns data.payouts (not normal_commissions)
      const normalCommissions = (summary as any).payouts ?? [];
      for (const c of normalCommissions) {
        const externalId = String(c.id ?? c.order_id ?? c.transaction_id ?? "");
        if (!externalId) continue;

        await db
          .insert(sales)
          .values({
            creatorId: creator.id,
            platform: "shopmy",
            saleDate: new Date(c.transaction_date ?? c.created_at ?? Date.now()),
            brand: c.merchant ?? c.brand ?? null,
            commissionAmount: c.amountEarned != null
              ? String(c.amountEarned)
              : parseShopMyAmount(c.commission_amount),
            orderValue: parseShopMyAmount(c.order_amount),
            productName: c.title ?? c.product_title ?? c.productTitle ?? c.name ?? null,
            status: mapShopMyStatus(c),
            externalOrderId: externalId,
          })
          .onConflictDoNothing();
      }

      // --- Upsert payments (completed payouts from /api/Payments/by_user) ---
      for (const p of payments) {
        const extId = p.id ?? null;
        if (extId == null) continue;

        await db
          .insert(shopmyPayments)
          .values({
            creatorId: creator.id,
            externalId: extId,
            amount: String(p.amount ?? 0),
            source: p.source ?? "PAYPAL",
            sentAt: p.sent_date ? new Date(p.sent_date) : null,
          })
          .onConflictDoUpdate({
            target: shopmyPayments.externalId,
            set: {
              amount: String(p.amount ?? 0),
              source: p.source ?? "PAYPAL",
              sentAt: p.sent_date ? new Date(p.sent_date) : null,
              syncedAt: new Date(),
            },
          });
      }

      // --- Upsert brand rates ---
      for (const br of brandRates) {
        // brand may be an object { name: "..." } or a plain string
        const brandName = typeof br.brand === "object" ? br.brand?.name ?? br.brand?.brand_name : br.brand;
        if (!brandName) continue;

        await db
          .insert(shopmyBrandRates)
          .values({
            creatorId: creator.id,
            brand: brandName,
            rate: br.rate != null ? String(br.rate) : null,
            rateReturning: br.rate_returning != null ? String(br.rate_returning) : null,
          })
          .onConflictDoUpdate({
            target: [shopmyBrandRates.creatorId, shopmyBrandRates.brand],
            set: {
              rate: br.rate != null ? String(br.rate) : null,
              rateReturning: br.rate_returning != null ? String(br.rate_returning) : null,
              brand: brandName,
              syncedAt: new Date(),
            },
          });
      }

      // --- Upsert platformEarnings from monthly totals ---
      // months keys: "2/28/26", "1/31/26" etc. (last day of each month)
      const months = (summary as any).months ?? {};
      for (const [monthKey, monthData] of Object.entries(months as Record<string, any>)) {
        // Parse "M/D/YY" → last day of month → derive first day
        const [m, d, y] = monthKey.split("/").map(Number);
        const fullYear = 2000 + y;
        const periodEnd = new Date(Date.UTC(fullYear, m - 1, d)).toISOString().split("T")[0];
        const periodStart = new Date(Date.UTC(fullYear, m - 1, 1)).toISOString().split("T")[0];
        const total = monthData.user_payout_total ?? 0;

        await db
          .insert(platformEarnings)
          .values({
            creatorId: creator.id,
            platform: "shopmy",
            periodStart,
            periodEnd,
            revenue: String(total),
            commission: String(total),
            rawPayload: JSON.stringify(monthData),
          })
          .onConflictDoUpdate({
            target: [
              platformEarnings.creatorId,
              platformEarnings.platform,
              platformEarnings.periodStart,
              platformEarnings.periodEnd,
            ],
            set: {
              revenue: String(total),
              commission: String(total),
              rawPayload: JSON.stringify(monthData),
              syncedAt: new Date(),
            },
          });
      }

      results.push({ creator: creator.id, status: "ok" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ creator: creator.id, status: "error", error: msg });
    }
  }

  const errorCount = results.filter((r) => r.status === "error").length;
  return NextResponse.json({
    synced: results.filter((r) => r.status === "ok").length,
    errors: errorCount,
    results,
  });
}
