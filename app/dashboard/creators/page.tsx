import { getAllCreatorsSummary } from "@/lib/queries";
import CreatorCard from "@/components/CreatorCard";

export const dynamic = "force-dynamic";

export default async function CreatorsPage() {
  const creatorsList = await getAllCreatorsSummary();

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Creators</h1>
      <p className="text-gray-500 mb-6">{creatorsList.length} creators tracked</p>

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
            <p className="text-gray-500">No creators yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
