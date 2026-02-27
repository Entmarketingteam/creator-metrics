import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  sales,
  platformEarnings,
  creators,
  shopmyOpportunityCommissions,
  shopmyPayments,
  shopmyBrandRates,
} from "@/lib/schema";
import {
  loginShopMy,
  fetchPayoutSummary,
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
      const [summary, brandRates] = await Promise.all([
        fetchPayoutSummary(session, creator.shopmyUserId),
        fetchBrandRates(session, creator.shopmyUserId),
      ]);

      // --- Upsert normal_commissions → sales table ---
      const normalCommissions = summary.normal_commissions ?? [];
      // Debug: log field keys from first record to catch API shape changes
      if (normalCommissions.length > 0) {
        console.log("[shopmy-sync] normal_commission keys:", Object.keys(normalCommissions[0]));
        console.log("[shopmy-sync] first record sample:", JSON.stringify(normalCommissions[0]));
      }
      if ((summary.opportunity_commissions ?? []).length > 0) {
        console.log("[shopmy-sync] opp_commission keys:", Object.keys((summary.opportunity_commissions ?? [])[0]));
        console.log("[shopmy-sync] first opp sample:", JSON.stringify((summary.opportunity_commissions ?? [])[0]));
      }
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
            // amountEarned is already a clean numeric string (no $ or ,)
            commissionAmount: c.amountEarned != null
              ? String(c.amountEarned)
              : parseShopMyAmount(c.commission_amount),
            orderValue: parseShopMyAmount(c.order_amount),
            productName: c.Product_title ?? c.product_title ?? c.productTitle ?? c.name ?? null,
            status: mapShopMyStatus(c),
            externalOrderId: externalId,
          })
          .onConflictDoNothing();
      }

      // --- Upsert opportunity_commissions ---
      const opCommissions = summary.opportunity_commissions ?? [];
      for (const oc of opCommissions) {
        const extId = oc.id ?? null;
        if (extId == null) continue;

        await db
          .insert(shopmyOpportunityCommissions)
          .values({
            creatorId: creator.id,
            externalId: extId,
            title: oc.title ?? oc.name ?? null,
            commissionAmount: parseShopMyAmount(oc.commission_amount ?? oc.amount),
            status: oc.statusDisplay ?? oc.status ?? null,
          })
          .onConflictDoUpdate({
            target: shopmyOpportunityCommissions.externalId,
            set: {
              title: oc.title ?? oc.name ?? null,
              commissionAmount: parseShopMyAmount(oc.commission_amount ?? oc.amount),
              status: oc.statusDisplay ?? oc.status ?? null,
              syncedAt: new Date(),
            },
          });
      }

      // --- Upsert payments ---
      const payments = summary.payments ?? [];
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
            sentAt: p.sent_at ? new Date(p.sent_at) : null,
          })
          .onConflictDoUpdate({
            target: shopmyPayments.externalId,
            set: {
              amount: String(p.amount ?? 0),
              source: p.source ?? "PAYPAL",
              sentAt: p.sent_at ? new Date(p.sent_at) : null,
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

      // --- Upsert platformEarnings totals ---
      // Use today as a single-day period for the summary snapshot
      const today = new Date().toISOString().split("T")[0];
      const totalCommission = normalCommissions.reduce(
        (sum: number, c: any) =>
          sum + Number(c.amountEarned ?? parseShopMyAmount(c.commission_amount)),
        0
      );
      const totalOrders = normalCommissions.length;

      await db
        .insert(platformEarnings)
        .values({
          creatorId: creator.id,
          platform: "shopmy",
          periodStart: today,
          periodEnd: today,
          revenue: String(totalCommission),
          commission: String(totalCommission),
          orders: totalOrders,
          status: "open",
          rawPayload: JSON.stringify({
            todayAmount: summary.todayAmount,
            normalCount: normalCommissions.length,
            opCount: opCommissions.length,
            paymentsCount: payments.length,
          }),
        })
        .onConflictDoUpdate({
          target: [
            platformEarnings.creatorId,
            platformEarnings.platform,
            platformEarnings.periodStart,
            platformEarnings.periodEnd,
          ],
          set: {
            revenue: String(totalCommission),
            commission: String(totalCommission),
            orders: totalOrders,
            syncedAt: new Date(),
          },
        });

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
