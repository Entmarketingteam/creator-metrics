import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { platformEarnings, sales, products } from "@/lib/schema";
import { sql, desc, eq } from "drizzle-orm";
import { DollarSign } from "lucide-react";
import EarningsCard from "@/components/earnings/EarningsCard";
import CommissionsSummary from "@/components/earnings/CommissionsSummary";
import PlatformBreakdown from "@/components/earnings/PlatformBreakdown";
import EarningsChart from "@/components/earnings/EarningsChart";
import SalesTable from "@/components/earnings/SalesTable";
import TopPerformers from "@/components/earnings/TopPerformers";

export const dynamic = "force-dynamic";

export default async function EarningsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Aggregate earnings across all creators
  const earningsSummary = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(CAST(${platformEarnings.revenue} AS FLOAT)), 0)`,
      totalCommission: sql<number>`COALESCE(SUM(CAST(${platformEarnings.commission} AS FLOAT)), 0)`,
    })
    .from(platformEarnings)
    .where(sql`${platformEarnings.syncedAt} >= NOW() - INTERVAL '30 days'`);

  // Pending vs paid
  const statusBreakdown = await db
    .select({
      status: platformEarnings.status,
      total: sql<number>`COALESCE(SUM(CAST(${platformEarnings.revenue} AS FLOAT)), 0)`,
    })
    .from(platformEarnings)
    .where(sql`${platformEarnings.syncedAt} >= NOW() - INTERVAL '30 days'`)
    .groupBy(platformEarnings.status);

  const pending = statusBreakdown.find((s) => s.status === "pending")?.total ?? 0;
  const paid = statusBreakdown.find((s) => s.status === "paid")?.total ?? 0;
  const totalRevenue = earningsSummary[0]?.totalRevenue ?? 0;

  // Platform breakdown
  const platformData = await db
    .select({
      platform: platformEarnings.platform,
      revenue: sql<number>`COALESCE(SUM(CAST(${platformEarnings.revenue} AS FLOAT)), 0)`,
    })
    .from(platformEarnings)
    .where(sql`${platformEarnings.syncedAt} >= NOW() - INTERVAL '30 days'`)
    .groupBy(platformEarnings.platform);

  const platformTotal = platformData.reduce((s, p) => s + Number(p.revenue), 0);
  const platformBreakdown = platformData.map((p) => ({
    platform: p.platform,
    revenue: Number(p.revenue),
    percentage: platformTotal > 0 ? Math.round((Number(p.revenue) / platformTotal) * 100) : 0,
  }));

  // Revenue time series (last 30 days by day)
  const revenueHistory = await db
    .select({
      date: sql<string>`${platformEarnings.periodStart}::text`,
      Revenue: sql<number>`COALESCE(SUM(CAST(${platformEarnings.revenue} AS FLOAT)), 0)`,
    })
    .from(platformEarnings)
    .where(sql`${platformEarnings.syncedAt} >= NOW() - INTERVAL '30 days'`)
    .groupBy(platformEarnings.periodStart)
    .orderBy(platformEarnings.periodStart);

  // Recent sales
  const recentSales = await db
    .select()
    .from(sales)
    .orderBy(desc(sales.saleDate))
    .limit(20);

  const salesCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(sales);

  // Top products
  const topProducts = await db
    .select()
    .from(products)
    .orderBy(desc(sql`CAST(${products.totalRevenue} AS FLOAT)`))
    .limit(5);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <DollarSign className="w-6 h-6 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Earnings</h1>
          <p className="text-gray-500">Track commission earnings across all platforms</p>
        </div>
      </div>

      {/* Top row: Earnings card + Commissions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <EarningsCard
          totalRevenue={totalRevenue}
          pendingPayment={pending}
          period="30 days"
        />
        <CommissionsSummary
          pending={pending}
          paid={paid}
          total={totalRevenue}
        />
      </div>

      {/* Middle row: Platform breakdown + Revenue chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <PlatformBreakdown data={platformBreakdown} />
        <EarningsChart data={revenueHistory} />
      </div>

      {/* Top Performers */}
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
    </div>
  );
}
