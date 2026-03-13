import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/amazon-data-push
 * Accepts Amazon Associates data from the local sync script and writes to DB.
 * Local Mac → this endpoint → Supabase (bypasses WAF + direct connection issues).
 *
 * Auth: Bearer CRON_SECRET
 *
 * Body:
 * {
 *   creator_id: string,
 *   monthly_rows: Array<{ period_start, period_end, revenue, commission, clicks, orders, raw_payload? }>,
 *   daily_rows: Array<{ day, clicks, ordered_items, shipped_items, revenue, commission }>,
 *   order_rows: Array<{ period_start, period_end, asin, title, ordered_items, shipped_items, revenue, commission }>
 * }
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { creator_id, monthly_rows = [], daily_rows = [], order_rows = [] } = body;
  if (!creator_id) {
    return NextResponse.json({ error: "creator_id required" }, { status: 400 });
  }

  const results = {
    monthly: { upserted: 0, errors: [] as string[] },
    daily: { upserted: 0, errors: [] as string[] },
    orders: { upserted: 0, errors: [] as string[] },
  };

  // ── Monthly earnings ─────────────────────────────────────────────────────
  for (const row of monthly_rows) {
    try {
      await db.execute(sql`
        INSERT INTO platform_earnings
          (creator_id, platform, period_start, period_end, revenue, commission, clicks, orders, raw_payload, synced_at)
        VALUES (
          ${creator_id}, 'amazon',
          ${row.period_start}::date, ${row.period_end}::date,
          ${row.revenue}::numeric, ${row.commission}::numeric,
          ${row.clicks}::int, ${row.orders}::int,
          ${row.raw_payload ?? null}::text,
          NOW()
        )
        ON CONFLICT (creator_id, platform, period_start, period_end)
        DO UPDATE SET
          revenue = EXCLUDED.revenue,
          commission = EXCLUDED.commission,
          clicks = EXCLUDED.clicks,
          orders = EXCLUDED.orders,
          raw_payload = EXCLUDED.raw_payload,
          synced_at = NOW()
      `);
      results.monthly.upserted++;
    } catch (e: any) {
      results.monthly.errors.push(`${row.period_start}: ${e.message}`);
    }
  }

  // ── Daily earnings ────────────────────────────────────────────────────────
  for (const row of daily_rows) {
    try {
      await db.execute(sql`
        INSERT INTO amazon_daily_earnings
          (creator_id, day, clicks, ordered_items, shipped_items, revenue, commission, synced_at)
        VALUES (
          ${creator_id}, ${row.day}::date,
          ${row.clicks ?? 0}::int, ${row.ordered_items ?? 0}::int, ${row.shipped_items ?? 0}::int,
          ${row.revenue ?? 0}::numeric, ${row.commission ?? 0}::numeric,
          NOW()
        )
        ON CONFLICT (creator_id, day) DO UPDATE SET
          clicks = EXCLUDED.clicks,
          ordered_items = EXCLUDED.ordered_items,
          shipped_items = EXCLUDED.shipped_items,
          revenue = EXCLUDED.revenue,
          commission = EXCLUDED.commission,
          synced_at = EXCLUDED.synced_at
      `);
      results.daily.upserted++;
    } catch (e: any) {
      results.daily.errors.push(`${row.day}: ${e.message}`);
    }
  }

  // ── Per-ASIN orders ───────────────────────────────────────────────────────
  for (const row of order_rows) {
    try {
      await db.execute(sql`
        INSERT INTO amazon_orders
          (creator_id, period_start, period_end, asin, title, ordered_items, shipped_items, revenue, commission, synced_at)
        VALUES (
          ${creator_id},
          ${row.period_start}::date, ${row.period_end}::date,
          ${row.asin}, ${row.title ?? null},
          ${row.ordered_items ?? 0}::int, ${row.shipped_items ?? 0}::int,
          ${row.revenue ?? 0}::numeric, ${row.commission ?? 0}::numeric,
          NOW()
        )
        ON CONFLICT (creator_id, period_start, asin) DO UPDATE SET
          title = EXCLUDED.title,
          ordered_items = EXCLUDED.ordered_items,
          shipped_items = EXCLUDED.shipped_items,
          revenue = EXCLUDED.revenue,
          commission = EXCLUDED.commission,
          synced_at = EXCLUDED.synced_at
      `);
      results.orders.upserted++;
    } catch (e: any) {
      results.orders.errors.push(`${row.asin}: ${e.message}`);
    }
  }

  return NextResponse.json({
    creator_id,
    results,
    total_errors: results.monthly.errors.length + results.daily.errors.length + results.orders.errors.length,
  });
}
