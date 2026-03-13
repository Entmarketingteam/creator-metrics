import { formatCurrency } from "@/lib/utils";
import type { AffiliatePlatform } from "@/lib/attribution";

export interface PostCardData {
  mediaIgId: string;
  postedAt: string;
  type: string;
  thumbnailUrl: string | null;
  linkUrl: string | null;
  platform: AffiliatePlatform | null;
  reach: number;
  likes: number;
  comments: number;
  views: number;
  saves?: number;
  attributedRevenue: number | null;
  orders: number | null;
}

const PLATFORM_STYLES: Record<AffiliatePlatform, { bg: string; text: string; label: string }> = {
  mavely:  { bg: "bg-purple-600",  text: "text-white", label: "Mavely" },
  ltk:     { bg: "bg-amber-500",   text: "text-white", label: "LTK" },
  shopmy:  { bg: "bg-pink-500",    text: "text-white", label: "ShopMy" },
  amazon:  { bg: "bg-gray-900",    text: "text-white", label: "Amazon" },
};

const TYPE_GRADIENTS: Record<string, string> = {
  video:      "from-purple-600 to-indigo-700",
  reel:       "from-pink-600 to-purple-700",
  story:      "from-indigo-500 to-blue-600",
  image:      "from-blue-500 to-cyan-600",
  carousel:   "from-green-500 to-teal-600",
};

function typeLabel(type: string): string {
  if (type.includes("video") || type.includes("reel")) return "Reel";
  if (type.includes("story")) return "Story";
  return "Post";
}

export default function PostCard({ post }: { post: PostCardData }) {
  const platformStyle = post.platform ? PLATFORM_STYLES[post.platform] : null;
  const gradient = TYPE_GRADIENTS[post.type] ?? TYPE_GRADIENTS.image;
  const engagementMetric = post.views > 0 ? post.views : post.reach;
  const engagementLabel = post.views > 0 ? "Views" : "Reach";
  const postedDate = new Date(post.postedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 transition-all cursor-pointer group">
      {/* Thumbnail */}
      <div className={`relative aspect-[4/5] bg-gradient-to-br ${gradient} flex items-center justify-center overflow-hidden`}>
        {post.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.thumbnailUrl}
            alt="Post"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <span className="text-white/50 text-sm">{typeLabel(post.type)}</span>
        )}

        {/* Platform badge */}
        {platformStyle ? (
          <span className={`absolute top-2 left-2 ${platformStyle.bg} ${platformStyle.text} text-[10px] font-bold px-2 py-0.5 rounded-full`}>
            {platformStyle.label}
          </span>
        ) : (
          <span className="absolute top-2 left-2 bg-gray-800/80 text-gray-400 text-[10px] font-medium px-2 py-0.5 rounded-full">
            No link
          </span>
        )}

        {/* Revenue badge */}
        {post.attributedRevenue != null && post.attributedRevenue > 0 && (
          <span className="absolute top-2 right-2 bg-black/70 text-emerald-400 text-[11px] font-bold px-2 py-0.5 rounded-full">
            {formatCurrency(post.attributedRevenue)}
          </span>
        )}
      </div>

      {/* Metrics */}
      <div className="p-3">
        <p className="text-[11px] text-gray-500 mb-2">{postedDate}</p>
        <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-[11px]">
          <div>
            <span className="text-gray-500 block">{engagementLabel}</span>
            <span className="text-white font-semibold">{engagementMetric.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Revenue</span>
            <span className={`font-semibold ${post.attributedRevenue ? "text-white" : "text-gray-600"}`}>
              {post.attributedRevenue != null ? formatCurrency(post.attributedRevenue) : "—"}
            </span>
          </div>
          <div>
            <span className="text-gray-500 block">Likes</span>
            <span className="text-white font-semibold">{post.likes.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Orders</span>
            <span className="text-white font-semibold">{post.orders ?? "—"}</span>
          </div>
        </div>

        {/* Affiliate link */}
        {post.linkUrl && (
          <div className={`mt-2 px-2 py-1.5 rounded-md text-[10px] truncate ${
            post.platform ? "bg-gray-800 text-gray-400" : "bg-gray-800/50 text-gray-600"
          }`}>
            🔗 {post.linkUrl}
          </div>
        )}
      </div>
    </div>
  );
}
