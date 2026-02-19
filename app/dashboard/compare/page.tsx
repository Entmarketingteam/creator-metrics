import { getAllCreatorsSummary, getComparison } from "@/lib/queries";
import { formatNumber } from "@/lib/utils";
import { BarChart } from "@tremor/react";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: { ids?: string };
}) {
  const allCreators = await getAllCreatorsSummary();
  const selectedIds = searchParams.ids?.split(",").filter(Boolean) ?? [];
  const comparison = selectedIds.length > 0 ? await getComparison(selectedIds) : [];

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Compare Creators</h1>
      <p className="text-gray-500 mb-6">Side-by-side performance analysis</p>

      {/* Creator selector */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 mb-8">
        <p className="text-sm text-gray-400 mb-3">Select creators to compare:</p>
        <div className="flex flex-wrap gap-2">
          {allCreators.map((c) => {
            const isSelected = selectedIds.includes(c.id);
            const newIds = isSelected
              ? selectedIds.filter((id) => id !== c.id)
              : [...selectedIds, c.id];
            return (
              <a
                key={c.id}
                href={`/dashboard/compare?ids=${newIds.join(",")}`}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  isSelected
                    ? "bg-blue-600 text-white ring-2 ring-blue-400/30"
                    : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
                }`}
              >
                @{c.username}
              </a>
            );
          })}
        </div>
      </div>

      {comparison.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Followers */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <h3 className="text-sm font-semibold text-gray-400 mb-4">Followers</h3>
            <BarChart
              data={comparison.map((c) => ({
                name: c.displayName ?? c.username ?? "",
                Followers: c.followersCount ?? 0,
              }))}
              index="name"
              categories={["Followers"]}
              colors={["blue"]}
              showAnimation
              className="h-48"
            />
          </div>

          {/* Posts */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <h3 className="text-sm font-semibold text-gray-400 mb-4">Total Posts</h3>
            <BarChart
              data={comparison.map((c) => ({
                name: c.displayName ?? c.username ?? "",
                Posts: c.mediaCount ?? 0,
              }))}
              index="name"
              categories={["Posts"]}
              colors={["violet"]}
              showAnimation
              className="h-48"
            />
          </div>

          {/* Reach (owned only) */}
          {comparison.some((c) => c.reach28d != null) && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
              <h3 className="text-sm font-semibold text-gray-400 mb-4">28-Day Reach</h3>
              <BarChart
                data={comparison
                  .filter((c) => c.reach28d != null)
                  .map((c) => ({
                    name: c.displayName ?? c.username ?? "",
                    Reach: c.reach28d ?? 0,
                  }))}
                index="name"
                categories={["Reach"]}
                colors={["cyan"]}
                showAnimation
                className="h-48"
              />
            </div>
          )}

          {/* Interactions (owned only) */}
          {comparison.some((c) => c.totalInteractions28d != null) && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
              <h3 className="text-sm font-semibold text-gray-400 mb-4">28-Day Interactions</h3>
              <BarChart
                data={comparison
                  .filter((c) => c.totalInteractions28d != null)
                  .map((c) => ({
                    name: c.displayName ?? c.username ?? "",
                    Interactions: c.totalInteractions28d ?? 0,
                  }))}
                index="name"
                categories={["Interactions"]}
                colors={["emerald"]}
                showAnimation
                className="h-48"
              />
            </div>
          )}
        </div>
      )}

      {selectedIds.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">Select creators above to see a comparison.</p>
        </div>
      )}
    </div>
  );
}
