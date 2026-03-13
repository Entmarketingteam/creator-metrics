import { getAllCreatorsSummary, getAggregateStats } from "@/lib/queries";
import { db } from "@/lib/db";
import { platformEarnings } from "@/lib/schema";
import { sql } from "drizzle-orm";
import { Users, UserCheck, Calendar, DollarSign, TrendingUp, ShoppingBag } from "lucide-react";
import MetricCard from "@/components/MetricCard";
import CreatorCard from "@/components/CreatorCard";
import { formatNumber, formatCurrency } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardOverview() {
  const [creatorsList, stats, earningsData] = await Promise.all([
    getAllCreatorsSummary(),
    getAggregateStats(),
    db
      .select({
        totalRevenue: sql<number>`COALESCE(SUM(CAST(${platformEarnings.revenue} AS FLOAT)), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${platformEarnings.orders}), 0)`,
        totalClicks: sql<number>`COALESCE(SUM(${platformEarnings.clicks}), 0)`,
      })
      .from(platformEarnings)
      .where(sql`${platformEarnings.syncedAt} >= NOW() - INTERVAL '30 days'`),
  ]);

  const earnings = earningsData[0];

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Dashboard</h1>
      <p className="text-gray-500 mb-6">Track your creator roster at a glance</p>

      {/* Top metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <MetricCard
          title="Creators Tracked"
          value={stats?.totalCreators ?? 0}
          icon={<Users className="w-4 h-4" />}
        />
        <MetricCard
          title="Total Followers"
          value={stats?.totalFollowers ?? 0}
          icon={<UserCheck className="w-4 h-4" />}
        />
        <MetricCard
          title="Last Updated"
          value={
            creatorsList[0]?.capturedAt
              ? new Date(creatorsList[0].capturedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "No data yet"
          }
          icon={<Calendar className="w-4 h-4" />}
        />
      </div>

      {/* Earnings summary cards */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Earnings (30d)</h2>
        <Link
          href="/dashboard/earnings"
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          View all earnings →
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <MetricCard
          title="Total Revenue"
          value={formatCurrency(earnings?.totalRevenue)}
          icon={<DollarSign className="w-4 h-4" />}
        />
        <MetricCard
          title="Total Orders"
          value={earnings?.totalOrders ?? 0}
          icon={<ShoppingBag className="w-4 h-4" />}
        />
        <MetricCard
          title="Total Clicks"
          value={earnings?.totalClicks ?? 0}
          icon={<TrendingUp className="w-4 h-4" />}
        />
      </div>

      {/* Creator grid */}
      <h2 className="text-lg font-semibold text-white mb-4">All Creators</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {creatorsList.map((c) => (
          <CreatorCard
            key={c.id}
            id={c.id}
            username={c.username}
            displayName={c.displayName}
            profilePictureUrl={c.profilePictureUrl}
            followersCount={c.followersCount}
            followsCount={c.followsCount}
            mediaCount={c.mediaCount}
            isOwned={c.isOwned}
            biography={c.biography}
          />
        ))}
        {creatorsList.length === 0 && (
          <div className="col-span-full text-center py-12">
            <p className="text-gray-500">No creators yet. Trigger the cron to start collecting data.</p>
          </div>
        )}
      </div>
    </div>
  );
}
