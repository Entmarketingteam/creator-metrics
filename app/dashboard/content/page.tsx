import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import PostCard, { type PostCardData } from "@/components/PostCard";
import { detectPlatform, detectManyChat } from "@/lib/attribution";
import { ImageIcon } from "lucide-react";

export const dynamic = "force-dynamic";

const PLATFORM_FILTERS = [
  { label: "All",       value: "" },
  { label: "Has Link",  value: "has-link" },
  { label: "ManyChat",  value: "manychat" },
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

  // Fetch posts + bulk revenue + last sync in parallel
  const [mediaRows, mavelyRows, ltkRows, syncRow] = await Promise.all([
    db.execute(sql`
      SELECT DISTINCT ON (media_ig_id)
        media_ig_id,
        "timestamp" AS posted_at,
        media_type,
        media_url,
        thumbnail_url,
        permalink,
        link_url,
        caption,
        like_count,
        comments_count,
        reach,
        saved
      FROM media_snapshots
      WHERE creator_id = ${creatorId}
        AND "timestamp" >= ${startDate}::date
        AND "timestamp" < (${endDate}::date + interval '1 day')
      ORDER BY media_ig_id, captured_at DESC
    `),
    // Mavely: group commissions by referrer URL (IG permalink is stored as referrer)
    db.execute(sql`
      SELECT referrer, SUM(commission_amount) AS revenue, COUNT(*) AS orders
      FROM mavely_transactions
      WHERE creator_id = ${creatorId}
        AND sale_date >= ${startDate}::date
        AND sale_date < (${endDate}::date + interval '1 day')
        AND referrer IS NOT NULL
      GROUP BY referrer
    `),
    // LTK: group commissions by share_url (= IG permalink)
    db.execute(sql`
      SELECT share_url, SUM(commissions) AS revenue, SUM(orders) AS orders
      FROM ltk_posts
      WHERE creator_id = ${creatorId}
        AND date_published >= ${startDate}::date
        AND date_published < (${endDate}::date + interval '1 day')
        AND share_url IS NOT NULL
      GROUP BY share_url
    `),
    // Last sync time for staleness indicator
    db.execute(sql`
      SELECT MAX(captured_at) AS last_sync
      FROM media_snapshots
      WHERE creator_id = ${creatorId}
    `),
  ]);

  // Staleness indicator
  const lastSyncRaw = (syncRow as any[])[0]?.last_sync as Date | null;
  let syncLabel = "Never synced";
  let syncColor = "text-red-400";
  if (lastSyncRaw) {
    const ageMs = Date.now() - new Date(lastSyncRaw).getTime();
    const ageMin = Math.floor(ageMs / 60000);
    const ageH = Math.floor(ageMs / 3600000);
    const ageD = Math.floor(ageMs / 86400000);
    if (ageMin < 60) { syncLabel = `Synced ${ageMin}m ago`; syncColor = "text-gray-500"; }
    else if (ageH < 24) { syncLabel = `Synced ${ageH}h ago`; syncColor = "text-gray-500"; }
    else if (ageD === 1) { syncLabel = `Synced 1d ago`; syncColor = "text-amber-400"; }
    else { syncLabel = `Synced ${ageD}d ago`; syncColor = "text-red-400"; }
  }

  // Build lookup maps for O(1) joins
  // Mavely: referrer is a URL that contains the IG permalink as a substring
  const mavelyByReferrer = new Map<string, { revenue: number; orders: number }>();
  for (const r of mavelyRows as any[]) {
    mavelyByReferrer.set(String(r.referrer), { revenue: Number(r.revenue), orders: Number(r.orders) });
  }
  // LTK: share_url exactly equals the IG permalink
  const ltkByShareUrl = new Map<string, { revenue: number; orders: number }>();
  for (const r of ltkRows as any[]) {
    ltkByShareUrl.set(String(r.share_url), { revenue: Number(r.revenue), orders: Number(r.orders) });
  }

  const posts: PostCardData[] = (mediaRows as any[])
    .map((row) => {
      const platform = detectPlatform((row as any).link_url ?? row.permalink);
      const manychatKeyword = detectManyChat(row.caption);
      const permalink = String(row.permalink ?? "");

      let attributedRevenue: number | null = null;
      let orders: number | null = null;

      if (platform === "mavely" && permalink) {
        // Mavely referrer is the full page URL; find the entry whose referrer contains this permalink
        for (const [referrer, data] of mavelyByReferrer) {
          if (referrer.includes(permalink)) {
            attributedRevenue = data.revenue;
            orders = data.orders;
            break;
          }
        }
      } else if (platform === "ltk" && permalink) {
        const match = ltkByShareUrl.get(permalink);
        if (match) { attributedRevenue = match.revenue; orders = match.orders; }
      }

      return {
        mediaIgId: String(row.media_ig_id),
        postedAt: String(row.posted_at),
        type: String(row.media_type ?? "image").toLowerCase(),
        thumbnailUrl: (row.thumbnail_url ?? row.media_url ?? null) as string | null,
        linkUrl: ((row as any).link_url ?? row.permalink ?? null) as string | null,
        platform,
        manychatKeyword,
        reach: Number(row.reach ?? 0),
        likes: Number(row.like_count ?? 0),
        comments: Number(row.comments_count ?? 0),
        views: 0,
        saves: Number(row.saved ?? 0),
        attributedRevenue,
        orders,
      } satisfies PostCardData;
    })
    .filter((p) => {
      const platformMatch =
        !platformFilter ||
        (platformFilter === "has-link" ? !!p.platform :
         platformFilter === "manychat" ? !!p.manychatKeyword :
         p.platform === platformFilter);
      const typeMatch =
        !typeFilter || p.type.includes(typeFilter);
      return platformMatch && typeMatch;
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

  const manychatCount = posts.filter((p) => p.manychatKeyword).length;
  const totalRevenue = posts.reduce((sum, p) => sum + (p.attributedRevenue ?? 0), 0);
  const postsWithRevenue = posts.filter((p) => (p.attributedRevenue ?? 0) > 0).length;

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
      <div className="flex items-center gap-6 text-sm text-gray-500 flex-wrap">
        <span>{posts.length} posts</span>
        <span>{posts.filter((p) => p.platform).length} with affiliate links</span>
        {totalRevenue > 0 && (
          <span className="text-emerald-400 font-semibold">
            ${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} attributed · {postsWithRevenue} posts
          </span>
        )}
        <span className="text-orange-400">{manychatCount} ManyChat triggers</span>
        <span>{posts.filter((p) => p.platform === "mavely").length} Mavely</span>
        <span>{posts.filter((p) => p.platform === "ltk").length} LTK</span>
        <span>{posts.filter((p) => p.platform === "shopmy").length} ShopMy</span>
        <span>{posts.filter((p) => p.platform === "amazon").length} Amazon</span>
        <span className={`ml-auto text-xs ${syncColor}`}>{syncLabel}</span>
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
