import { getAllCreatorsSummary } from "@/lib/queries";
import CreatorCard from "@/components/CreatorCard";

export const dynamic = "force-dynamic";

export default async function CreatorsPage() {
  const creatorsList = await getAllCreatorsSummary();

  return (
    <div>
      <h1 className="text-2xl font-bold text-tremor-content-strong mb-6">
        Creators
      </h1>
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
          <p className="text-tremor-content">
            No creators yet. Run the data collection cron to populate.
          </p>
        )}
      </div>
    </div>
  );
}
