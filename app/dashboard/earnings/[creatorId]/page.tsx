import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  creators,
  platformEarnings,
  sales,
  products,
  platformConnections,
  shopmyOpportunityCommissions,
} from "@/lib/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Link2, ShoppingBag } from "lucide-react";
import EarningsCard from "@/components/earnings/EarningsCard";
import CommissionsSummary from "@/components/earnings/CommissionsSummary";
import PlatformBreakdown from "@/components/earnings/PlatformBreakdown";
import EarningsChart from "@/components/earnings/EarningsChart";
import SalesTable from "@/components/earnings/SalesTable";
import TopPerformers from "@/components/earnings/TopPerformers";
import PlatformBadge from "@/components/earnings/PlatformBadge";
import OpportunityCommissions from "@/components/earnings/OpportunityCommissions";

export const dynamic = "force-dynamic";

function getDateRange(from?: string, to?: string): { start: Date; end: Date } {
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const start = from ? new Date(from) : defaultStart;
  const end = to ? new Date(to) : defaultEnd;
  return { start: isNaN(start.getTime()) ? defaultStart : start, end: isNaN(end.getTime()) ? defaultEnd : end };
}

export default async function CreatorEarningsPage({
  params,
  searchParams,
}: {
  params: { creatorId: string };
  searchParams: { from?: string; to?: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { start: rangeStart, end: rangeEnd } = getDateRange(searchParams.from, searchParams.to);
  const rangeStartStr = rangeStart.toISOString().slice(0, 10);
  const rangeEndStr = rangeEnd.toISOString().slice(0, 10);

  const [creator] = await db
    .select()
    .from(creators)
    .where(eq(creators.id, params.creatorId));

  if (!creator) notFound();

  // Platform connections
  const connections = await db
    .select()
    .from(platformConnections)
    .where(eq(platformConnections.creatorId, params.creatorId));

  // Earnings summary — most recent row per platform within the selected date range.
  // DISTINCT ON picks the row with the latest synced_at for each platform.
  const latestPerPlatform = await db.execute(sql`
    SELECT DISTINCT ON (platform) platform,
      CAST(revenue AS FLOAT) AS revenue,
      CAST(commission AS FLOAT) AS commission,
      status,
      period_start
    FROM platform_earnings
    WHERE creator_id = ${params.creatorId}
      AND period_start >= ${rangeStartStr}::date
      AND period_end   <= ${rangeEndStr}::date
    ORDER BY platform, synced_at DESC
  `);

  const totalRevenue = (latestPerPlatform as any[]).reduce(
    (s, r) => s + (Number(r.revenue) || 0), 0
  );

  // Status breakdown from most-recent-per-platform
  const statusMap: Record<string, number> = {};
  for (const r of latestPerPlatform as any[]) {
    const st = r.status ?? "open";
    statusMap[st] = (statusMap[st] ?? 0) + (Number(r.revenue) || 0);
  }
  const pending = statusMap["pending"] ?? 0;
  const paid = statusMap["paid"] ?? 0;

  // Platform breakdown from most-recent-per-platform
  const platformTotal = totalRevenue;
  const platformBreakdown = (latestPerPlatform as any[]).map((r) => ({
    platform: r.platform as string,
    revenue: Number(r.revenue) || 0,
    percentage: platformTotal > 0 ? Math.round(((Number(r.revenue) || 0) / platformTotal) * 100) : 0,
  }));

  // Revenue history — monthly buckets within the selected date range.
  // MAX per (platform, month) avoids double-counting rolling-window rows.
  const revenueHistoryRaw = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', period_start::date), 'YYYY-MM-DD') AS date,
      SUM(revenue_val) AS "Revenue"
    FROM (
      SELECT
        date_trunc('month', period_start::date) AS month,
        platform,
        MAX(CAST(revenue AS FLOAT)) AS revenue_val
      FROM platform_earnings
      WHERE creator_id = ${params.creatorId}
        AND period_start >= ${rangeStartStr}::date
        AND period_end   <= ${rangeEndStr}::date
      GROUP BY date_trunc('month', period_start::date), platform
    ) deduped
    GROUP BY date_trunc('month', period_start::date)
    ORDER BY date_trunc('month', period_start::date)
  `);

  const revenueHistory = (revenueHistoryRaw as any[]).map((r) => ({
    date: r.date as string,
    Revenue: Number(r.Revenue) || 0,
  }));

  // Recent sales
  const recentSales = await db
    .select()
    .from(sales)
    .where(eq(sales.creatorId, params.creatorId))
    .orderBy(desc(sales.saleDate))
    .limit(20);

  const salesCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(sales)
    .where(eq(sales.creatorId, params.creatorId));

  // Top products
  const topProducts = await db
    .select()
    .from(products)
    .where(eq(products.creatorId, params.creatorId))
    .orderBy(desc(sql`CAST(${products.totalRevenue} AS FLOAT)`))
    .limit(5);

  // ShopMy-specific data
  const [shopmySales, shopmyOpCommissions] = await Promise.all([
    db
      .select()
      .from(sales)
      .where(
        and(
          eq(sales.creatorId, params.creatorId),
          eq(sales.platform, "shopmy")
        )
      )
      .orderBy(desc(sales.saleDate))
      .limit(50),
    db
      .select()
      .from(shopmyOpportunityCommissions)
      .where(eq(shopmyOpportunityCommissions.creatorId, params.creatorId))
      .orderBy(desc(shopmyOpportunityCommissions.syncedAt)),
  ]);

  const hasShopMyData = shopmySales.length > 0 || shopmyOpCommissions.length > 0;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Creator Header */}
      <div className="flex items-start gap-6 mb-8">
        <Avatar className="h-20 w-20 ring-4 ring-gray-800">
          {creator.profilePictureUrl ? (
            <AvatarImage src={creator.profilePictureUrl} alt={creator.username} />
          ) : null}
          <AvatarFallback className="text-2xl font-bold bg-gray-800">
            {(creator.displayName ?? creator.username).charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white mb-1">
            {creator.displayName ?? creator.username}
          </h1>
          <p className="text-gray-400 mb-3">@{creator.username} — Earnings Dashboard</p>
          {connections.length > 0 && (
            <div className="flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5 text-gray-500" />
              {connections.map((c) => (
                <PlatformBadge key={c.id} platform={c.platform} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Earnings overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <EarningsCard
          totalRevenue={totalRevenue}
          pendingPayment={pending}
          period={`${rangeStartStr} – ${rangeEndStr}`}
        />
        <CommissionsSummary pending={pending} paid={paid} total={totalRevenue} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <PlatformBreakdown data={platformBreakdown} />
        <EarningsChart data={revenueHistory} platforms={[]} />
      </div>

      {/* Top Products */}
      {topProducts.length > 0 && (
        <div className="mb-6">
          <TopPerformers products={topProducts} />
        </div>
      )}

      {/* Sales Table */}
      <SalesTable
        initialData={recentSales.map((s) => ({
          id: s.id,
          platform: s.platform,
          saleDate: s.saleDate.toISOString(),
          productName: s.productName,
          brand: s.brand,
          commissionAmount: s.commissionAmount,
          orderValue: s.orderValue,
          status: s.status,
        }))}
        totalCount={salesCount[0]?.count ?? 0}
      />

      {/* ShopMy Section */}
      {hasShopMyData && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <ShoppingBag className="w-4 h-4 text-pink-400" />
            <h2 className="text-lg font-semibold text-white">ShopMy</h2>
          </div>

          {shopmyOpCommissions.length > 0 && (
            <div className="mb-6">
              <OpportunityCommissions data={shopmyOpCommissions} />
            </div>
          )}

          {shopmySales.length > 0 && (
            <SalesTable
              initialData={shopmySales.map((s) => ({
                id: s.id,
                platform: s.platform,
                saleDate: s.saleDate.toISOString(),
                productName: s.productName,
                brand: s.brand,
                commissionAmount: s.commissionAmount,
                orderValue: s.orderValue,
                status: s.status,
              }))}
              totalCount={shopmySales.length}
            />
          )}
        </div>
      )}
    </div>
  );
}
