import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getCreatorOverview,
  getCreatorHistory,
  getRecentPosts,
  getRecentPostsByViews,
} from "@/lib/queries";
import { CREATORS } from "@/lib/creators";
import { fetchLtkOverview } from "@/lib/ltk";
import { db } from "@/lib/db";
import { platformEarnings, sales, shopmyOpportunityCommissions } from "@/lib/schema";
import { eq, sql, and, count } from "drizzle-orm";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import MetricCard from "@/components/MetricCard";
import FollowerChart from "@/components/FollowerChart";
import EngagementChart from "@/components/EngagementChart";
import PostGrid from "@/components/PostGrid";
import LtkSection from "@/components/LtkSection";
import { formatNumber, formatCurrency } from "@/lib/utils";
import { Eye, Zap, TrendingUp, Grid3x3, Flame, DollarSign, ShoppingBag } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CreatorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { creator, latest, previous } = await getCreatorOverview(params.id);
  if (!creator) notFound();

  const config = CREATORS.find((c) => c.id === params.id);

  const [history, thisWeekPosts, recentPosts, ltk, earningsData, shopmyEarningsData] =
    await Promise.all([
      getCreatorHistory(params.id, 90),
      getRecentPostsByViews(params.id, 7),
      getRecentPosts(params.id, 25),
      config?.ltkSlug ? fetchLtkOverview(config.ltkSlug) : Promise.resolve(null),
      db
        .select({
          totalRevenue: sql<number>`COALESCE(SUM(CAST(${platformEarnings.revenue} AS FLOAT)), 0)`,
          totalOrders: sql<number>`COALESCE(SUM(${platformEarnings.orders}), 0)`,
          totalClicks: sql<number>`COALESCE(SUM(${platformEarnings.clicks}), 0)`,
        })
        .from(platformEarnings)
        .where(
          and(
            eq(platformEarnings.creatorId, params.id),
            sql`${platformEarnings.syncedAt} >= NOW() - INTERVAL '30 days'`
          )
        ),
      db
        .select({
          totalCommission: sql<number>`COALESCE(SUM(CAST(${sales.commissionAmount} AS FLOAT)), 0)`,
          totalSales: sql<number>`COUNT(*)`,
        })
        .from(sales)
        .where(
          and(eq(sales.creatorId, params.id), eq(sales.platform, "shopmy"))
        ),
    ]);

  const earnings = earningsData[0];
  const shopmyEarnings = shopmyEarningsData[0];

  const followerChange =
    latest && previous
      ? (latest.followersCount ?? 0) - (previous.followersCount ?? 0)
      : null;

  const followerChartData = history.map((h) => ({
    date: h.capturedAt,
    Followers: h.followersCount ?? 0,
  }));

  const engagementChartData = history
    .filter((h) => h.reach28d != null)
    .map((h) => ({
      date: h.capturedAt,
      Reach: h.reach28d ?? 0,
      Engaged: h.accountsEngaged28d ?? 0,
      Interactions: h.totalInteractions28d ?? 0,
    }));

  return (
    <div className="max-w-6xl mx-auto">
      {/* Profile Header — Instagram style */}
      <div className="flex items-start gap-8 mb-8">
        <Avatar className="h-28 w-28 ring-4 ring-gray-800">
          {creator.profilePictureUrl ? (
            <AvatarImage src={creator.profilePictureUrl} alt={creator.username} />
          ) : null}
          <AvatarFallback className="text-3xl font-bold bg-gray-800">
            {(creator.displayName ?? creator.username).charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-white">
              {creator.displayName ?? creator.username}
            </h1>
            {creator.isOwned && <Badge variant="success">Owned Account</Badge>}
            <a
              href={`https://instagram.com/${creator.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              View on Instagram
            </a>
          </div>
          <p className="text-gray-400 mb-3">@{creator.username}</p>

          {/* Stats row */}
          <div className="flex gap-8 mb-3">
            <div>
              <span className="font-bold text-white">{formatNumber(latest?.mediaCount)}</span>{" "}
              <span className="text-gray-400">posts</span>
            </div>
            <div>
              <span className="font-bold text-white">{formatNumber(latest?.followersCount)}</span>{" "}
              <span className="text-gray-400">followers</span>
              {followerChange != null && followerChange !== 0 && (
                <span className={`ml-1 text-sm ${followerChange > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  ({followerChange > 0 ? "+" : ""}{formatNumber(followerChange)})
                </span>
              )}
            </div>
            <div>
              <span className="font-bold text-white">{formatNumber(latest?.followsCount)}</span>{" "}
              <span className="text-gray-400">following</span>
            </div>
          </div>

          {creator.biography && (
            <p className="text-sm text-gray-300 max-w-lg">{creator.biography}</p>
          )}
        </div>
      </div>

      {/* Insights cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="Followers"
          value={latest?.followersCount ?? 0}
          change={followerChange}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <MetricCard
          title="Posts"
          value={latest?.mediaCount ?? 0}
          icon={<Grid3x3 className="w-4 h-4" />}
        />
        {latest?.reach28d != null && (
          <MetricCard
            title="Reach (28d)"
            value={latest.reach28d}
            icon={<Eye className="w-4 h-4" />}
          />
        )}
        {latest?.totalInteractions28d != null && (
          <MetricCard
            title="Interactions (28d)"
            value={latest.totalInteractions28d}
            icon={<Zap className="w-4 h-4" />}
          />
        )}
      </div>

      {/* LTK overview — powered by ent-dashboard-scaffold */}
      {ltk && <LtkSection overview={ltk} />}

      {/* Earnings Summary */}
      {(earnings?.totalRevenue ?? 0) > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <h2 className="text-lg font-semibold text-white">Earnings (30d)</h2>
            </div>
            <Link
              href={`/dashboard/earnings/${params.id}`}
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              View details →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              title="Revenue"
              value={formatCurrency(earnings?.totalRevenue)}
              icon={<DollarSign className="w-4 h-4" />}
            />
            <MetricCard
              title="Orders"
              value={earnings?.totalOrders ?? 0}
              icon={<ShoppingBag className="w-4 h-4" />}
            />
            <MetricCard
              title="Clicks"
              value={earnings?.totalClicks ?? 0}
              icon={<TrendingUp className="w-4 h-4" />}
            />
          </div>
        </div>
      )}

      {/* ShopMy Earnings Card */}
      {(shopmyEarnings?.totalCommission ?? 0) > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-pink-400" />
              <h2 className="text-lg font-semibold text-white">ShopMy Earnings</h2>
            </div>
            <Link
              href={`/dashboard/earnings/${params.id}`}
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              View details →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricCard
              title="Commission"
              value={formatCurrency(shopmyEarnings?.totalCommission)}
              icon={<DollarSign className="w-4 h-4" />}
            />
            <MetricCard
              title="Sales"
              value={shopmyEarnings?.totalSales ?? 0}
              icon={<ShoppingBag className="w-4 h-4" />}
            />
          </div>
        </div>
      )}

      {/* This Week's Top Posts — sorted by views/reach */}
      {thisWeekPosts.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Flame className="w-4 h-4 text-orange-400" />
            <h2 className="text-lg font-semibold text-white">This Week&apos;s Top Posts</h2>
            <span className="text-xs text-gray-500 ml-auto">Sorted by views</span>
          </div>
          <PostGrid posts={thisWeekPosts} />
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <FollowerChart data={followerChartData} />
        <EngagementChart data={engagementChartData} />
      </div>

      {/* All Recent Posts */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Grid3x3 className="w-4 h-4 text-gray-400" />
          <h2 className="text-lg font-semibold text-white">All Recent Posts</h2>
        </div>
        <PostGrid posts={recentPosts} />
      </div>
    </div>
  );
}
