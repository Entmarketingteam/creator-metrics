import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { platformEarnings, sales, products } from "@/lib/schema";
import { sql, desc } from "drizzle-orm";
import BrandBreakdown, { type BrandRow } from "@/components/earnings/BrandBreakdown";
import { DollarSign, MousePointerClick, ShoppingCart, TrendingUp } from "lucide-react";
import PlatformCard, { type PlatformCardData } from "@/components/earnings/PlatformCard";
import PlatformBreakdown from "@/components/earnings/PlatformBreakdown";
import EarningsChart, { type ChartDataPoint } from "@/components/earnings/EarningsChart";
import SalesTable from "@/components/earnings/SalesTable";
import TopPerformers from "@/components/earnings/TopPerformers";
import { formatCurrency } from "@/lib/utils";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

const PLATFORMS = ["ltk", "shopmy", "mavely", "amazon"] as const;

export default async function EarningsPage({
  searchParams,
}: {
  searchParams: { startDate?: string; endDate?: string; creatorId?: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 29 * 86400000).toISOString().split("T")[0];
  const startDate = searchParams.startDate ?? thirtyDaysAgo;
  const endDate = searchParams.endDate ?? today;
  const creatorId = searchParams.creatorId; // undefined = all creators
  const periodLabel = `${startDate} – ${endDate}`;

  // ── Per-platform: SUM all rows for each platform within the window ──
  // GROUP BY instead of DISTINCT ON — handles Amazon (multiple monthly rows)
  // and other platforms (one row per period) correctly.
  const latestPerPlatform = await db.execute(sql`
    SELECT
      platform,
      CAST(COALESCE(SUM(CAST(revenue AS FLOAT)), 0) AS FLOAT) AS revenue,
      CAST(COALESCE(SUM(CAST(commission AS FLOAT)), 0) AS FLOAT) AS commission,
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(orders), 0) AS orders,
      MAX(synced_at) AS synced_at
    FROM platform_earnings
    WHERE period_end >= ${startDate}::date
      AND period_start <= ${endDate}::date
      ${creatorId ? sql`AND creator_id = ${creatorId}` : sql``}
    GROUP BY platform
  `);

  // Build a map of platform → data, with zeros for missing platforms
  const platformMap = new Map<string, PlatformCardData>();
  const PLATFORM_DETAIL_HREF: Partial<Record<string, string>> = {
    amazon: "/dashboard/earnings/amazon",
  };

  for (const platform of PLATFORMS) {
    platformMap.set(platform, {
      platform,
      revenue: 0,
      commission: 0,
      clicks: 0,
      orders: 0,
      periodLabel,
      syncedAt: null,
      detailHref: PLATFORM_DETAIL_HREF[platform],
    });
  }
  for (const row of latestPerPlatform as any[]) {
    const key = String(row.platform).toLowerCase();
    platformMap.set(key, {
      platform: key,
      revenue: Number(row.revenue),
      commission: Number(row.commission),
      clicks: Number(row.clicks),
      orders: Number(row.orders),
      periodLabel,
      syncedAt: row.synced_at ? String(row.synced_at) : null,
      detailHref: PLATFORM_DETAIL_HREF[key],
    });
  }

  const platformCards = PLATFORMS.map((p) => platformMap.get(p)!);

  // ── Summary totals across all platforms ──────────────────────────
  const totalRevenue = platformCards.reduce((s, c) => s + c.revenue, 0);
  const totalCommission = platformCards.reduce((s, c) => s + c.commission, 0);
  const totalClicks = platformCards.reduce((s, c) => s + (c.clicks ?? 0), 0);
  const totalOrders = platformCards.reduce((s, c) => s + (c.orders ?? 0), 0);
  const totalCvr = totalClicks > 0 ? ((totalOrders / totalClicks) * 100).toFixed(1) + "%" : "—";

  // ── Platform breakdown for bar chart ─────────────────────────────
  const platformTotal = platformCards.reduce((s, c) => s + c.commission, 0);
  const platformBreakdown = platformCards
    .filter((c) => c.commission > 0)
    .map((c) => ({
      platform: c.platform,
      revenue: c.commission,
      percentage: platformTotal > 0 ? Math.round((c.commission / platformTotal) * 100) : 0,
    }));

  // ── Time series chart: revenue per platform over time ────────────
  const timeSeriesRaw = await db.execute(sql`
    SELECT
      period_end::text AS date,
      platform,
      CAST(COALESCE(commission, '0') AS FLOAT) AS commission
    FROM platform_earnings
    WHERE period_end >= ${startDate}::date
      AND period_start <= ${endDate}::date
      ${creatorId ? sql`AND creator_id = ${creatorId}` : sql``}
    ORDER BY period_end ASC, platform ASC
  `);

  // Pivot: { date → { platform: commission } }
  const chartMap = new Map<string, Record<string, number>>();
  const activePlatforms = new Set<string>();
  for (const row of timeSeriesRaw as any[]) {
    const d = String(row.date);
    const p = String(row.platform);
    if (!chartMap.has(d)) chartMap.set(d, {});
    chartMap.get(d)![p] = Number(row.commission);
    activePlatforms.add(p);
  }

  // Build chart data using platform labels as keys (Tremor needs readable names)
  const PLATFORM_LABELS_MAP: Record<string, string> = {
    ltk: "LTK",
    shopmy: "ShopMy",
    mavely: "Mavely",
    amazon: "Amazon",
  };
  const chartData: ChartDataPoint[] = Array.from(chartMap.entries()).map(
    ([date, vals]) => {
      const point: ChartDataPoint = { date };
      for (const [p, v] of Object.entries(vals)) {
        const label = PLATFORM_LABELS_MAP[p] ?? p;
        point[label] = v;
      }
      return point;
    }
  );
  const chartPlatforms = Array.from(activePlatforms).filter((p) =>
    PLATFORMS.includes(p as any)
  );

  // ── Brand breakdown from sales ────────────────────────────────────
  const brandBreakdownRaw = await db.execute(sql`
    SELECT
      brand,
      COUNT(*)::int AS sales,
      ROUND(SUM(commission_amount::numeric), 2) AS commission
    FROM sales
    WHERE sale_date >= ${startDate}::date
      AND sale_date <= ${endDate}::date
      AND brand IS NOT NULL
      ${creatorId ? sql`AND creator_id = ${creatorId}` : sql``}
    GROUP BY brand
    ORDER BY commission DESC
    LIMIT 10
  `);
  const brandBreakdown: BrandRow[] = (brandBreakdownRaw as any[]).map((r) => ({
    brand: String(r.brand),
    commission: Number(r.commission),
    sales: Number(r.sales),
  }));

  // ── Recent sales + top products ───────────────────────────────────
  const salesDateFilter = creatorId
    ? sql`${sales.saleDate} >= ${startDate}::date AND ${sales.saleDate} <= ${endDate}::date AND ${sales.creatorId} = ${creatorId}`
    : sql`${sales.saleDate} >= ${startDate}::date AND ${sales.saleDate} <= ${endDate}::date`;

  const [recentSales, salesCountResult, topProducts] = await Promise.all([
    db
      .select()
      .from(sales)
      .where(salesDateFilter)
      .orderBy(desc(sales.saleDate))
      .limit(20),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sales)
      .where(salesDateFilter),
    db
      .select()
      .from(products)
      .orderBy(desc(sql`CAST(${products.totalRevenue} AS FLOAT)`))
      .limit(5),
  ]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DollarSign className="w-6 h-6 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Earnings</h1>
            <p className="text-gray-500 text-sm">
              Affiliate revenue across all platforms · Nicki Entenmann
            </p>
          </div>
        </div>
      </div>

      {/* ── Summary stats row ───────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-xs text-gray-500 mb-1">Total Commission</p>
          <p className="text-xl font-bold text-white">{formatCurrency(totalCommission)}</p>
          <p className="text-xs text-gray-600 mt-1">{periodLabel}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <MousePointerClick className="h-3.5 w-3.5 text-gray-500" />
            <p className="text-xs text-gray-500">Total Clicks</p>
          </div>
          <p className="text-xl font-bold text-white">{totalClicks.toLocaleString()}</p>
          <p className="text-xs text-gray-600 mt-1">across all platforms</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <ShoppingCart className="h-3.5 w-3.5 text-gray-500" />
            <p className="text-xs text-gray-500">Total Orders</p>
          </div>
          <p className="text-xl font-bold text-white">{totalOrders.toLocaleString()}</p>
          <p className="text-xs text-gray-600 mt-1">across all platforms</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="h-3.5 w-3.5 text-gray-500" />
            <p className="text-xs text-gray-500">Avg. Conversion</p>
          </div>
          <p className="text-xl font-bold text-white">{totalCvr}</p>
          <p className="text-xs text-gray-600 mt-1">orders ÷ clicks</p>
        </div>
      </div>

      {/* ── Per-platform cards ──────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {platformCards.map((card) => (
          <PlatformCard key={card.platform} data={card} />
        ))}
      </div>

      {/* ── Chart + Breakdown row ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <EarningsChart data={chartData} platforms={chartPlatforms} />
        </div>
        <div className="lg:col-span-2">
          <PlatformBreakdown data={platformBreakdown} />
        </div>
      </div>

      {/* ── Brand breakdown + top performers ────────────────────── */}
      {brandBreakdown.length > 0 && <BrandBreakdown data={brandBreakdown} />}
      {topProducts.length > 0 && <TopPerformers products={topProducts.map((p) => ({ ...p, id: 0, productName: p.productName ?? "" }))} />}

      {/* ── Sales table ─────────────────────────────────────────── */}
      <SalesTable
        initialData={recentSales.map((s) => ({
          id: s.id,
          platform: s.platform,
          saleDate: s.saleDate?.toISOString() ?? "",
          productName: s.productName,
          brand: s.brand,
          commissionAmount: s.commissionAmount,
          orderValue: s.orderValue,
          status: s.status,
        }))}
        totalCount={salesCountResult[0]?.count ?? 0}
      />
    </div>
  );
}
