import { getAllCreatorsSummary, getAggregateStats } from "@/lib/queries";
import { Users, UserCheck, Calendar } from "lucide-react";
import MetricCard from "@/components/MetricCard";
import CreatorCard from "@/components/CreatorCard";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardOverview() {
  const [creatorsList, stats] = await Promise.all([
    getAllCreatorsSummary(),
    getAggregateStats(),
  ]);

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
