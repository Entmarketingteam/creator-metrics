import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import PostCard, { type PostCardData } from "@/components/PostCard";
import { detectPlatform } from "@/lib/attribution";
import { ImageIcon } from "lucide-react";

export const dynamic = "force-dynamic";

const PLATFORM_FILTERS = [
  { label: "All",       value: "" },
  { label: "Has Link",  value: "has-link" },
  { label: "Mavely",    value: "mavely" },
  { label: "ShopMy",    value: "shopmy" },
  { label: "LTK",       value: "ltk" },
  { label: "Amazon",    value: "amazon" },
];

const TYPE_FILTERS = [
  { label: "All",     value: "" },
  { label: "Reels",   value: "reel" },
  { label: "Posts",   value: "image" },
  { label: "Stories", value: "story" },
];

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{
    startDate?: string;
    endDate?: string;
    creatorId?: string;
    platform?: string;
    type?: string;
  }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const params = await searchParams;

  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 29 * 86400000).toISOString().split("T")[0];
  const startDate = params.startDate ?? thirtyDaysAgo;
  const endDate = params.endDate ?? today;
  const creatorId = params.creatorId ?? "nicki_entenmann";
  const platformFilter = params.platform ?? "";
  const typeFilter = params.type ?? "";

  // Fetch latest snapshot per post in date range
  // Schema columns: media_ig_id, timestamp (postedAt), media_type, media_url,
  // thumbnail_url, permalink, like_count, comments_count, reach, saved, captured_at
  const mediaRows = await db.execute(sql`
    SELECT DISTINCT ON (media_ig_id)
      media_ig_id,
      "timestamp" AS posted_at,
      media_type,
      media_url,
      thumbnail_url,
      permalink,
      like_count,
      comments_count,
      reach,
      saved
    FROM media_snapshots
    WHERE creator_id = ${creatorId}
      AND "timestamp" >= ${startDate}::date
      AND "timestamp" < (${endDate}::date + interval '1 day')
    ORDER BY media_ig_id, captured_at DESC
  `);

  // Enrich with platform detection (from permalink — will be null for all IG URLs)
  const posts: PostCardData[] = (mediaRows as any[])
    .map((row) => {
      const platform = detectPlatform(row.permalink);
      return {
        mediaIgId: String(row.media_ig_id),
        postedAt: String(row.posted_at),
        type: String(row.media_type ?? "image").toLowerCase(),
        thumbnailUrl: (row.thumbnail_url ?? row.media_url ?? null) as string | null,
        linkUrl: (row.permalink ?? null) as string | null,
        platform,
        reach: Number(row.reach ?? 0),
        likes: Number(row.like_count ?? 0),
        comments: Number(row.comments_count ?? 0),
        views: 0,
        saves: Number(row.saved ?? 0),
        attributedRevenue: null,
        orders: null,
      } satisfies PostCardData;
    })
    .filter((p) => {
      if (platformFilter === "has-link") return !!p.platform;
      if (platformFilter) return p.platform === platformFilter;
      if (typeFilter) return p.type.includes(typeFilter);
      return true;
    });

  const buildFilterUrl = (key: string, value: string) => {
    const resolvedParams = {
      ...(params.startDate ? { startDate: params.startDate } : {}),
      ...(params.endDate ? { endDate: params.endDate } : {}),
      ...(params.creatorId ? { creatorId: params.creatorId } : {}),
      ...(params.platform ? { platform: params.platform } : {}),
      ...(params.type ? { type: params.type } : {}),
      [key]: value,
    };
    const urlParams = new URLSearchParams(
      Object.fromEntries(
        Object.entries(resolvedParams).filter(([, v]) => v !== undefined && v !== "")
      ) as Record<string, string>
    );
    return `/dashboard/content${urlParams.size > 0 ? `?${urlParams.toString()}` : ""}`;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ImageIcon className="w-6 h-6 text-indigo-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Content</h1>
          <p className="text-gray-500 text-sm">
            Post attribution · {startDate} – {endDate} · {creatorId.replace(/_/g, " ")}
          </p>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {TYPE_FILTERS.map(({ label, value }) => (
            <a
              key={value}
              href={buildFilterUrl("type", value)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                typeFilter === value
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
              }`}
            >
              {label}
            </a>
          ))}
        </div>
        <span className="text-gray-700">·</span>
        <div className="flex gap-1.5 flex-wrap">
          {PLATFORM_FILTERS.map(({ label, value }) => (
            <a
              key={value}
              href={buildFilterUrl("platform", value)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                platformFilter === value
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
              }`}
            >
              {label}
            </a>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-6 text-sm text-gray-500">
        <span>{posts.length} posts</span>
        <span>{posts.filter((p) => p.platform).length} with affiliate links</span>
        <span>{posts.filter((p) => p.platform === "mavely").length} Mavely</span>
        <span>{posts.filter((p) => p.platform === "ltk").length} LTK</span>
        <span>{posts.filter((p) => p.platform === "shopmy").length} ShopMy</span>
        <span>{posts.filter((p) => p.platform === "amazon").length} Amazon</span>
      </div>

      {/* Card grid */}
      {posts.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          No posts found for this date range and filter.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {posts.map((post) => (
            <PostCard key={post.mediaIgId} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
