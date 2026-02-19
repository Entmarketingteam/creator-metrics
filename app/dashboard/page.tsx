import { getAllCreatorsSummary, getAggregateStats } from "@/lib/queries";
import MetricCard from "@/components/MetricCard";
import CreatorCard from "@/components/CreatorCard";

export const dynamic = "force-dynamic";

export default async function DashboardOverview() {
  const [creatorsList, stats] = await Promise.all([
    getAllCreatorsSummary(),
    getAggregateStats(),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-tremor-content-strong mb-6">
        Dashboard
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <MetricCard
          title="Creators Tracked"
          value={stats?.totalCreators ?? 0}
        />
        <MetricCard
          title="Total Followers"
          value={stats?.totalFollowers ?? 0}
        />
        <MetricCard
          title="Last Updated"
          value={
            creatorsList[0]?.capturedAt
              ? new Date(creatorsList[0].capturedAt).toLocaleDateString()
              : "No data yet"
          }
        />
      </div>

      <h2 className="text-lg font-semibold text-tremor-content-strong mb-4">
        All Creators
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {creatorsList.map((c) => (
          <CreatorCard
            key={c.id}
            id={c.id}
            username={c.username}
            displayName={c.displayName}
            followersCount={c.followersCount}
            mediaCount={c.mediaCount}
            isOwned={c.isOwned}
          />
        ))}
        {creatorsList.length === 0 && (
          <p className="text-tremor-content col-span-full">
            No creators yet. Run the data collection cron to populate.
          </p>
        )}
      </div>
    </div>
  );
}
