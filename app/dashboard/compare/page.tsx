import { getAllCreatorsSummary, getComparison } from "@/lib/queries";
import { Card, BarList } from "@tremor/react";

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
    <div>
      <h1 className="text-2xl font-bold text-tremor-content-strong mb-6">
        Compare Creators
      </h1>

      {/* Selector */}
      <Card className="p-4 mb-8">
        <p className="text-sm text-tremor-content mb-3">
          Select creators to compare (add IDs to URL: ?ids=creator1,creator2)
        </p>
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
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  isSelected
                    ? "bg-tremor-brand text-white"
                    : "bg-tremor-background-subtle text-tremor-content hover:text-tremor-content-emphasis"
                }`}
              >
                @{c.username}
              </a>
            );
          })}
        </div>
      </Card>

      {comparison.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Followers comparison */}
          <Card className="p-4">
            <h3 className="text-sm font-medium text-tremor-content mb-4">
              Followers
            </h3>
            <BarList
              data={comparison.map((c) => ({
                name: c.displayName ?? c.username ?? c.creatorId,
                value: c.followersCount ?? 0,
              }))}
              color="blue"
            />
          </Card>

          {/* Media count comparison */}
          <Card className="p-4">
            <h3 className="text-sm font-medium text-tremor-content mb-4">
              Total Posts
            </h3>
            <BarList
              data={comparison.map((c) => ({
                name: c.displayName ?? c.username ?? c.creatorId,
                value: c.mediaCount ?? 0,
              }))}
              color="violet"
            />
          </Card>

          {/* Reach comparison (owned only) */}
          {comparison.some((c) => c.reach28d != null) && (
            <Card className="p-4">
              <h3 className="text-sm font-medium text-tremor-content mb-4">
                28-Day Reach
              </h3>
              <BarList
                data={comparison
                  .filter((c) => c.reach28d != null)
                  .map((c) => ({
                    name: c.displayName ?? c.username ?? c.creatorId,
                    value: c.reach28d ?? 0,
                  }))}
                color="cyan"
              />
            </Card>
          )}

          {/* Engagement comparison (owned only) */}
          {comparison.some((c) => c.totalInteractions28d != null) && (
            <Card className="p-4">
              <h3 className="text-sm font-medium text-tremor-content mb-4">
                28-Day Interactions
              </h3>
              <BarList
                data={comparison
                  .filter((c) => c.totalInteractions28d != null)
                  .map((c) => ({
                    name: c.displayName ?? c.username ?? c.creatorId,
                    value: c.totalInteractions28d ?? 0,
                  }))}
                color="emerald"
              />
            </Card>
          )}
        </div>
      )}

      {comparison.length === 0 && selectedIds.length === 0 && (
        <p className="text-tremor-content">
          Select creators above to see a comparison.
        </p>
      )}
    </div>
  );
}
