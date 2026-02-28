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

export default async function CreatorEarningsPage({
  params,
}: {
  params: { creatorId: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

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

  // Earnings summary (30 days)
  const earningsSummary = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(CAST(${platformEarnings.revenue} AS FLOAT)), 0)`,
    })
    .from(platformEarnings)
    .where(
      and(
        eq(platformEarnings.creatorId, params.creatorId),
        sql`${platformEarnings.syncedAt} >= NOW() - INTERVAL '30 days'`
      )
    );

  // Status breakdown
  const statusBreakdown = await db
    .select({
      status: platformEarnings.status,
      total: sql<number>`COALESCE(SUM(CAST(${platformEarnings.revenue} AS FLOAT)), 0)`,
    })
    .from(platformEarnings)
    .where(
      and(
        eq(platformEarnings.creatorId, params.creatorId),
        sql`${platformEarnings.syncedAt} >= NOW() - INTERVAL '30 days'`
      )
    )
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
    .where(
      and(
        eq(platformEarnings.creatorId, params.creatorId),
        sql`${platformEarnings.syncedAt} >= NOW() - INTERVAL '30 days'`
      )
    )
    .groupBy(platformEarnings.platform);

  const platformTotal = platformData.reduce((s, p) => s + Number(p.revenue), 0);
  const platformBreakdown = platformData.map((p) => ({
    platform: p.platform,
    revenue: Number(p.revenue),
    percentage: platformTotal > 0 ? Math.round((Number(p.revenue) / platformTotal) * 100) : 0,
  }));

  // Revenue history
  const revenueHistory = await db
    .select({
      date: sql<string>`${platformEarnings.periodStart}::text`,
      Revenue: sql<number>`COALESCE(SUM(CAST(${platformEarnings.revenue} AS FLOAT)), 0)`,
    })
    .from(platformEarnings)
    .where(
      and(
        eq(platformEarnings.creatorId, params.creatorId),
        sql`${platformEarnings.syncedAt} >= NOW() - INTERVAL '30 days'`
      )
    )
    .groupBy(platformEarnings.periodStart)
    .orderBy(platformEarnings.periodStart);

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
          period="30 days"
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
