import { notFound } from "next/navigation";
import {
  getCreatorOverview,
  getCreatorHistory,
  getRecentPosts,
  getTopPosts,
} from "@/lib/queries";
import MetricCard from "@/components/MetricCard";
import FollowerChart from "@/components/FollowerChart";
import EngagementChart from "@/components/EngagementChart";
import PostGrid from "@/components/PostGrid";

export const dynamic = "force-dynamic";

export default async function CreatorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { creator, latest, previous } = await getCreatorOverview(params.id);
  if (!creator) notFound();

  const [history, recentPosts, topPosts] = await Promise.all([
    getCreatorHistory(params.id, 90),
    getRecentPosts(params.id, 25),
    getTopPosts(params.id, 6),
  ]);

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
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-tremor-content-strong">
          {creator.displayName ?? creator.username}
        </h1>
        <p className="text-tremor-content">@{creator.username}</p>
        {creator.isOwned && (
          <span className="text-xs bg-tremor-brand/20 text-tremor-brand px-2 py-0.5 rounded-full mt-1 inline-block">
            Owned Account — Full Insights
          </span>
        )}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="Followers"
          value={latest?.followersCount ?? 0}
          change={followerChange}
        />
        <MetricCard title="Posts" value={latest?.mediaCount ?? 0} />
        {latest?.reach28d != null && (
          <MetricCard title="Reach (28d)" value={latest.reach28d} />
        )}
        {latest?.totalInteractions28d != null && (
          <MetricCard
            title="Interactions (28d)"
            value={latest.totalInteractions28d}
          />
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <FollowerChart data={followerChartData} />
        <EngagementChart data={engagementChartData} />
      </div>

      {/* Top Posts */}
      {topPosts.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-tremor-content-strong mb-4">
            Top Performing Posts
          </h2>
          <PostGrid
            posts={topPosts.map((p) => ({
              ...p,
              postedAt: p.postedAt,
              mediaProductType: p.mediaProductType,
            }))}
          />
        </div>
      )}

      {/* Recent Posts */}
      <div>
        <h2 className="text-lg font-semibold text-tremor-content-strong mb-4">
          Recent Posts
        </h2>
        <PostGrid
          posts={recentPosts.map((p) => ({
            ...p,
            postedAt: p.postedAt,
            mediaProductType: p.mediaProductType,
          }))}
        />
      </div>
    </div>
  );
}
