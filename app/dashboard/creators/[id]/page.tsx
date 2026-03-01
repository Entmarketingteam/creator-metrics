import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getCreatorOverview,
  getCreatorHistory,
  getRecentPosts,
} from "@/lib/queries";
import { db } from "@/lib/db";
import { platformEarnings, sales } from "@/lib/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import MetricCard from "@/components/MetricCard";
import FollowerChart from "@/components/FollowerChart";
import EngagementChart from "@/components/EngagementChart";
import PostGrid from "@/components/PostGrid";
import PlatformCard from "@/components/earnings/PlatformCard";
import { formatNumber, formatCurrency } from "@/lib/utils";
import {
  Eye,
  Zap,
  TrendingUp,
  Grid3x3,
  Flame,
  DollarSign,
  Users,
  Play,
  ImageIcon,
  BarChart2,
  ExternalLink,
  Clock,
  RotateCcw,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CreatorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { creator, latest, previous } = await getCreatorOverview(params.id);
  if (!creator) notFound();

  const [
    history,
    allPosts,
    ltkRaw,
    shopmyRaw,
    mavelyRaw,
    shopmyCurrentMonthRaw,
  ] = await Promise.all([
    getCreatorHistory(params.id, 90),

    // Fetch 60 most recent posts for type-filtering
    getRecentPosts(params.id, 60),

    // LTK — 30-day record (period spans ~30 days vs 7-day record)
    db
      .select({
        revenue: sql<number>`COALESCE(CAST(${platformEarnings.revenue} AS FLOAT), 0)`,
        commission: sql<number>`COALESCE(CAST(${platformEarnings.commission} AS FLOAT), 0)`,
        clicks: sql<number>`COALESCE(${platformEarnings.clicks}, 0)`,
        orders: sql<number>`COALESCE(${platformEarnings.orders}, 0)`,
        syncedAt: sql<string>`${platformEarnings.syncedAt}::text`,
      })
      .from(platformEarnings)
      .where(
        and(
          eq(platformEarnings.creatorId, params.id),
          eq(platformEarnings.platform, "ltk"),
          // Select the 30-day range: period spans at least 20 days
          sql`(${platformEarnings.periodEnd}::date - ${platformEarnings.periodStart}::date) >= 20`
        )
      )
      .orderBy(desc(platformEarnings.syncedAt))
      .limit(1),

    // ShopMy — all-time total across all monthly records
    db
      .select({
        revenue: sql<number>`COALESCE(SUM(CAST(${platformEarnings.revenue} AS FLOAT)), 0)`,
        commission: sql<number>`COALESCE(SUM(CAST(${platformEarnings.commission} AS FLOAT)), 0)`,
        syncedAt: sql<string>`MAX(${platformEarnings.syncedAt})::text`,
        monthCount: sql<number>`COUNT(*)`,
      })
      .from(platformEarnings)
      .where(
        and(
          eq(platformEarnings.creatorId, params.id),
          eq(platformEarnings.platform, "shopmy")
        )
      ),

    // Mavely — all records summed
    db
      .select({
        revenue: sql<number>`COALESCE(SUM(CAST(${platformEarnings.revenue} AS FLOAT)), 0)`,
        commission: sql<number>`COALESCE(SUM(CAST(${platformEarnings.commission} AS FLOAT)), 0)`,
        syncedAt: sql<string>`MAX(${platformEarnings.syncedAt})::text`,
      })
      .from(platformEarnings)
      .where(
        and(
          eq(platformEarnings.creatorId, params.id),
          eq(platformEarnings.platform, "mavely")
        )
      ),

    // ShopMy current month (most recent period)
    db
      .select({
        revenue: sql<number>`COALESCE(CAST(${platformEarnings.revenue} AS FLOAT), 0)`,
        periodStart: platformEarnings.periodStart,
        periodEnd: platformEarnings.periodEnd,
      })
      .from(platformEarnings)
      .where(
        and(
          eq(platformEarnings.creatorId, params.id),
          eq(platformEarnings.platform, "shopmy")
        )
      )
      .orderBy(desc(platformEarnings.periodEnd))
      .limit(1),
  ]);

  const ltk = ltkRaw[0] ?? { revenue: 0, commission: 0, clicks: 0, orders: 0, syncedAt: null };
  const shopmy = shopmyRaw[0] ?? { revenue: 0, commission: 0, syncedAt: null, monthCount: 0 };
  const mavely = mavelyRaw[0] ?? { revenue: 0, commission: 0, syncedAt: null };
  const shopmyCurrent = shopmyCurrentMonthRaw[0];

  // Total: LTK 30d net commissions + ShopMy all-time + Mavely all-time
  // NOTE: LTK is 30-day rolling; ShopMy & Mavely are all-time totals (different periods by design)
  const totalEarnings =
    (ltk.revenue ?? 0) + (shopmy.revenue ?? 0) + (mavely.revenue ?? 0);

  const hasEarnings = creator.isOwned && totalEarnings > 0;

  // Split posts by content type
  const reels = allPosts.filter((p) => p.mediaProductType === "REELS");
  const stories = allPosts.filter((p) => p.mediaProductType === "STORY");
  const feedPosts = allPosts.filter(
    (p) => p.mediaProductType !== "REELS" && p.mediaProductType !== "STORY"
  );

  // "Hot right now" — posts from last 48h sorted by reach
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const hotPosts = allPosts
    .filter((p) => p.postedAt && new Date(p.postedAt) > cutoff)
    .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));

  // Reels performance aggregates
  const reelsWithWatchTime = reels.filter(
    (r) => r.reelsAvgWatchTimeMs != null && r.reelsAvgWatchTimeMs > 0
  );
  const avgWatchTimeSec =
    reelsWithWatchTime.length > 0
      ? reelsWithWatchTime.reduce((s, r) => s + (r.reelsAvgWatchTimeMs ?? 0), 0) /
        reelsWithWatchTime.length /
        1000
      : null;

  // Replay rate = total plays / unique reach (avg across reels that have both)
  const reelsWithReplay = reels.filter(
    (r) => r.viewsCount != null && r.reach != null && r.reach > 0
  );
  const avgReplayRate =
    reelsWithReplay.length > 0
      ? reelsWithReplay.reduce(
          (s, r) => s + (r.viewsCount ?? 0) / (r.reach ?? 1),
          0
        ) / reelsWithReplay.length
      : null;

  // Avg reach per reel
  const reelsWithReach = reels.filter((r) => r.reach != null && r.reach > 0);
  const avgReelReach =
    reelsWithReach.length > 0
      ? Math.round(
          reelsWithReach.reduce((s, r) => s + (r.reach ?? 0), 0) /
            reelsWithReach.length
        )
      : null;

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

  const shopmyCurrentLabel = shopmyCurrent
    ? `${shopmyCurrent.periodStart} – ${shopmyCurrent.periodEnd}`
    : "all-time";

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-16">
      {/* ── Profile Header ───────────────────────────────────────────── */}
      <div className="flex items-start gap-8">
        <Avatar className="h-28 w-28 ring-4 ring-gray-800 shrink-0">
          {creator.profilePictureUrl ? (
            <AvatarImage src={creator.profilePictureUrl} alt={creator.username} />
          ) : null}
          <AvatarFallback className="text-3xl font-bold bg-gray-800">
            {(creator.displayName ?? creator.username).charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-white">
              {creator.displayName ?? creator.username}
            </h1>
            {creator.isOwned && <Badge variant="success">Owned Account</Badge>}
          </div>
          <p className="text-gray-400 mb-3">@{creator.username}</p>

          <div className="flex flex-wrap gap-6 mb-3 text-sm">
            <div>
              <span className="font-bold text-white">{formatNumber(latest?.mediaCount)}</span>{" "}
              <span className="text-gray-400">posts</span>
            </div>
            <div>
              <span className="font-bold text-white">{formatNumber(latest?.followersCount)}</span>{" "}
              <span className="text-gray-400">followers</span>
              {followerChange != null && followerChange !== 0 && (
                <span className={`ml-1 text-xs ${followerChange > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  ({followerChange > 0 ? "+" : ""}{formatNumber(followerChange)})
                </span>
              )}
            </div>
            <div>
              <span className="font-bold text-white">{formatNumber(latest?.followsCount)}</span>{" "}
              <span className="text-gray-400">following</span>
            </div>
          </div>

          {/* Platform links */}
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://instagram.com/${creator.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-400 hover:bg-pink-500/20 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Instagram
            </a>
            {creator.ltkPublisherId && (
              <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400">
                LTK #{creator.ltkPublisherId}
              </span>
            )}
            {creator.shopmyUserId && (
              <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-300">
                ShopMy #{creator.shopmyUserId}
              </span>
            )}
            {creator.mavelyCreatorId && (
              <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                Mavely
              </span>
            )}
          </div>

          {creator.biography && (
            <p className="text-sm text-gray-300 mt-3 max-w-lg">{creator.biography}</p>
          )}
        </div>
      </div>

      {/* ── Instagram Audience ───────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-pink-400" />
          <h2 className="text-base font-semibold text-white">Instagram Audience</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
      </section>

      {/* ── Earnings ─────────────────────────────────────────────────── */}
      {creator.isOwned && <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <h2 className="text-base font-semibold text-white">Platform Earnings</h2>
          </div>
          <Link
            href={`/dashboard/earnings/${params.id}`}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            Full breakdown →
          </Link>
        </div>

        {/* Combined total banner */}
        {totalEarnings > 0 && (
          <div className="mb-5 rounded-xl bg-gradient-to-r from-gray-900 via-gray-850 to-gray-900 border border-gray-700 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Combined Total</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(totalEarnings)}</p>
              <p className="text-xs text-gray-500 mt-1">
                LTK (30d) · ShopMy (all-time) · Mavely (all-time)
              </p>
            </div>
            <div className="flex gap-4 text-center">
              {(ltk.revenue ?? 0) > 0 && (
                <div>
                  <p className="text-sm font-semibold text-violet-400">{formatCurrency(ltk.revenue)}</p>
                  <p className="text-xs text-gray-500">LTK</p>
                </div>
              )}
              {(shopmy.revenue ?? 0) > 0 && (
                <div>
                  <p className="text-sm font-semibold text-pink-400">{formatCurrency(shopmy.revenue)}</p>
                  <p className="text-xs text-gray-500">ShopMy</p>
                </div>
              )}
              {(mavely.revenue ?? 0) > 0 && (
                <div>
                  <p className="text-sm font-semibold text-emerald-400">{formatCurrency(mavely.revenue)}</p>
                  <p className="text-xs text-gray-500">Mavely</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Per-platform cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PlatformCard
            data={{
              platform: "ltk",
              revenue: ltk.revenue ?? 0,
              commission: ltk.commission ?? 0,
              clicks: ltk.clicks ?? 0,
              orders: ltk.orders ?? 0,
              periodLabel: "30-day",
              syncedAt: ltk.syncedAt ?? null,
            }}
          />
          <PlatformCard
            data={{
              platform: "shopmy",
              revenue: shopmy.revenue ?? 0,
              commission: shopmy.commission ?? 0,
              clicks: 0,
              orders: 0,
              periodLabel:
                (shopmy.monthCount ?? 0) > 1
                  ? `${shopmy.monthCount} months (all-time)`
                  : "current month",
              syncedAt: shopmy.syncedAt ?? null,
            }}
          />
          <PlatformCard
            data={{
              platform: "mavely",
              revenue: mavely.revenue ?? 0,
              commission: mavely.commission ?? 0,
              clicks: 0,
              orders: 0,
              periodLabel: "all-time",
              syncedAt: mavely.syncedAt ?? null,
            }}
          />
        </div>
      </section>}

      {/* ── Hot Right Now ─────────────────────────────────────────────── */}
      {hotPosts.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Flame className="w-4 h-4 text-orange-400" />
            <h2 className="text-base font-semibold text-white">Hot Right Now</h2>
            <span className="text-xs text-gray-500 ml-auto">Last 48 hours · sorted by views</span>
          </div>
          <PostGrid posts={hotPosts.slice(0, 6)} />
        </section>
      )}

      {/* ── Reels ─────────────────────────────────────────────────────── */}
      {reels.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Play className="w-4 h-4 text-blue-400 fill-blue-400" />
            <h2 className="text-base font-semibold text-white">Reels</h2>
            <span className="text-xs text-gray-500 ml-1">({reels.length})</span>
          </div>

          {/* Reels performance summary */}
          {(avgWatchTimeSec != null || avgReplayRate != null || avgReelReach != null) && (
            <div className="flex flex-wrap gap-3 mb-4">
              {avgWatchTimeSec != null && (
                <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-lg px-4 py-2.5">
                  <Clock className="w-4 h-4 text-orange-400" />
                  <div>
                    <p className="text-xs text-gray-500">Avg watch time</p>
                    <p className="text-sm font-bold text-white">{avgWatchTimeSec.toFixed(1)}s</p>
                  </div>
                </div>
              )}
              {avgReplayRate != null && (
                <div className="flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-lg px-4 py-2.5">
                  <RotateCcw className="w-4 h-4 text-violet-400" />
                  <div>
                    <p className="text-xs text-gray-500">Avg replay rate</p>
                    <p className="text-sm font-bold text-white">{avgReplayRate.toFixed(2)}x</p>
                  </div>
                </div>
              )}
              {avgReelReach != null && (
                <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-2.5">
                  <Eye className="w-4 h-4 text-blue-400" />
                  <div>
                    <p className="text-xs text-gray-500">Avg reach / Reel</p>
                    <p className="text-sm font-bold text-white">{formatNumber(avgReelReach)}</p>
                  </div>
                </div>
              )}
              {avgWatchTimeSec != null && (
                <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <div>
                    <p className="text-xs text-gray-500">Est. hook strength</p>
                    <p className="text-sm font-bold text-white">
                      {avgWatchTimeSec >= 10
                        ? "🔥 Strong"
                        : avgWatchTimeSec >= 5
                        ? "⚡ Good"
                        : avgWatchTimeSec >= 3
                        ? "📊 Average"
                        : "⚠️ Weak"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <PostGrid posts={reels.slice(0, 12)} />
        </section>
      )}

      {/* ── Feed Posts ────────────────────────────────────────────────── */}
      {feedPosts.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <ImageIcon className="w-4 h-4 text-purple-400" />
            <h2 className="text-base font-semibold text-white">Posts</h2>
            <span className="text-xs text-gray-500 ml-1">({feedPosts.length})</span>
          </div>
          <PostGrid posts={feedPosts.slice(0, 12)} />
        </section>
      )}

      {/* ── Stories ───────────────────────────────────────────────────── */}
      {stories.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-4 h-4 rounded-full border-2 border-orange-400 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-orange-400" />
            </div>
            <h2 className="text-base font-semibold text-white">Stories</h2>
            <span className="text-xs text-gray-500 ml-1">({stories.length})</span>
          </div>
          <PostGrid posts={stories.slice(0, 12)} />
        </section>
      )}

      {/* ── Growth Charts ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 className="w-4 h-4 text-gray-400" />
          <h2 className="text-base font-semibold text-white">Growth (90 days)</h2>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FollowerChart data={followerChartData} />
          <EngagementChart data={engagementChartData} />
        </div>
      </section>

      {/* ── All Recent Content ────────────────────────────────────────── */}
      {allPosts.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Grid3x3 className="w-4 h-4 text-gray-400" />
            <h2 className="text-base font-semibold text-white">All Recent Content</h2>
            <span className="text-xs text-gray-500 ml-auto">{allPosts.length} items</span>
          </div>
          <PostGrid posts={allPosts} />
        </section>
      )}
    </div>
  );
}
