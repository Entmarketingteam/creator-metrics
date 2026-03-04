"use client";

import Image from "next/image";
import {
  Heart,
  MessageCircle,
  Eye,
  Bookmark,
  Share2,
  Play,
  Clock,
  Link,
  DollarSign,
  MousePointerClick,
  ExternalLink,
} from "lucide-react";
import {
  PLATFORM_LOGO_ICON,
  PLATFORM_LOGO_INVERT,
  formatNumber,
  formatCurrency,
} from "@/lib/utils";

function affiliatePlatform(url: string): { label: string; color: string } | null {
  if (/mavely\.app\.link|mave\.ly/.test(url)) return { label: "Mavely", color: "bg-emerald-500/80" };
  if (/liketk\.it|ltk\.app|liketoknow\.it/.test(url)) return { label: "LTK", color: "bg-violet-500/80" };
  if (/shopmy\.us|shop\.my/.test(url)) return { label: "ShopMy", color: "bg-pink-500/80" };
  if (/amzn\.to|amazon\.com/.test(url)) return { label: "Amazon", color: "bg-orange-500/80" };
  return { label: "Link", color: "bg-blue-500/80" };
}

interface Post {
  mediaIgId: string;
  mediaType: string | null;
  mediaProductType?: string | null;
  caption: string | null;
  permalink: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  likeCount: number | null;
  commentsCount: number | null;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  postedAt: Date | null;
  reelsAvgWatchTimeMs?: number | null;
  viewsCount?: number | null;
  linkUrl?: string | null;
}

interface PostAttribution {
  platform: "mavely" | "ltk" | "shopmy";
  clicks: number;
  commission: number;
  revenue: number;
  orders: number;
  title: string | null;
  imageUrl: string | null;
}

export default function PostGrid({
  posts,
  attribution,
  variant = "grid",
}: {
  posts: Post[];
  attribution?: Record<string, PostAttribution>;
  variant?: "grid" | "stories";
}) {
  if (posts.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>No posts collected yet. Data populates on the next cron run.</p>
      </div>
    );
  }

  const isStoriesVariant = variant === "stories";

  return (
    <div
      className={
        isStoriesVariant
          ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5 sm:gap-2"
          : "grid grid-cols-3 gap-1 md:gap-3"
      }
    >
      {posts.map((post) => {
        const imgSrc = post.thumbnailUrl ?? post.mediaUrl;
        const isVideo = post.mediaType === "VIDEO" || post.mediaProductType === "REELS";
        const isReel = post.mediaProductType === "REELS";
        const isStory = post.mediaProductType === "STORY";

        const avgWatchSec =
          isReel && post.reelsAvgWatchTimeMs != null
            ? (post.reelsAvgWatchTimeMs / 1000).toFixed(1)
            : null;

        const replayRate =
          isReel && post.viewsCount != null && post.reach != null && post.reach > 0
            ? (post.viewsCount / post.reach).toFixed(1)
            : null;

        const attr = post.linkUrl ? attribution?.[post.linkUrl] : undefined;
        const hasRevenue = attr && attr.commission > 0;

        // Platform detected from link URL
        const linkPlatform = post.linkUrl ? affiliatePlatform(post.linkUrl) : null;
        const linkPlatformKey = linkPlatform
          ? linkPlatform.label.toLowerCase().replace(" ", "")
          : null;
        const linkLogoSrc = linkPlatformKey ? PLATFORM_LOGO_ICON[linkPlatformKey] : null;

        const href = post.permalink ?? (post.linkUrl ?? "#");

        return (
          <a
            key={post.mediaIgId}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`group relative bg-gray-900 rounded-lg overflow-hidden ${
              isStoriesVariant ? "aspect-[9/16]" : "aspect-square"
            }`}
          >
            {/* Thumbnail */}
            {imgSrc ? (
              <Image
                src={imgSrc}
                alt={post.caption?.slice(0, 60) ?? "Post"}
                fill
                className="object-cover group-hover:opacity-40 transition-opacity"
                sizes={
                  isStoriesVariant
                    ? "(max-width: 640px) 33vw, (max-width: 768px) 25vw, 16vw"
                    : "(max-width: 768px) 33vw, 300px"
                }
                unoptimized
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
                <span className="text-gray-600 text-[10px]">No preview</span>
              </div>
            )}

            {/* Video/Reel indicator */}
            {isVideo && (
              <div className="absolute top-1.5 right-1.5 z-10">
                <Play className="w-4 h-4 text-white drop-shadow-lg fill-white" />
              </div>
            )}

            {/* Type badge — top-left */}
            {post.mediaProductType && (
              <div className="absolute top-1.5 left-1.5 z-10">
                <span className="text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm">
                  {isReel ? "Reel" : isStory ? "Story" : "Post"}
                </span>
              </div>
            )}

            {/* ── Link platform badge — bottom-left (always visible) ── */}
            {post.linkUrl && linkPlatform && (
              <div className="absolute bottom-1.5 left-1.5 z-10">
                <span
                  className={`inline-flex items-center gap-1 text-[9px] font-semibold ${linkPlatform.color} text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm shadow-sm`}
                >
                  {linkLogoSrc ? (
                    <Image
                      src={linkLogoSrc}
                      alt={linkPlatform.label}
                      width={9}
                      height={9}
                      className={`object-contain ${
                        linkPlatformKey && PLATFORM_LOGO_INVERT.has(linkPlatformKey)
                          ? "invert"
                          : ""
                      }`}
                      unoptimized
                    />
                  ) : (
                    <Link className="w-2 h-2" />
                  )}
                  {linkPlatform.label}
                </span>
              </div>
            )}

            {/* ── Revenue attribution badge — bottom-right (always visible) ── */}
            {hasRevenue && (
              <div className="absolute bottom-1.5 right-1.5 z-10">
                <span
                  className={`inline-flex items-center gap-0.5 text-[9px] font-bold ${
                    attr!.platform === "ltk"
                      ? "bg-violet-600/90"
                      : attr!.platform === "shopmy"
                      ? "bg-pink-600/90"
                      : "bg-emerald-600/90"
                  } text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm`}
                >
                  <DollarSign className="w-2 h-2" />
                  {formatCurrency(attr!.commission).replace("$", "")}
                </span>
              </div>
            )}

            {/* ── Hover overlay (+ tap on mobile via group-active) ── */}
            <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity bg-black/50 backdrop-blur-[1px]">
              <div className="flex flex-wrap gap-1.5 sm:gap-2 justify-center px-1.5 py-2">
                {post.reach != null && (
                  <div className="flex items-center gap-1 bg-black/60 rounded-full px-2 py-0.5 backdrop-blur-sm">
                    <Eye className="w-3 h-3 text-purple-400" />
                    <span className="text-[10px] font-semibold text-white">{formatNumber(post.reach)}</span>
                  </div>
                )}
                {post.likeCount != null && (
                  <div className="flex items-center gap-1 bg-black/60 rounded-full px-2 py-0.5 backdrop-blur-sm">
                    <Heart className="w-3 h-3 text-red-400 fill-red-400" />
                    <span className="text-[10px] font-semibold text-white">{formatNumber(post.likeCount)}</span>
                  </div>
                )}
                {post.commentsCount != null && (
                  <div className="flex items-center gap-1 bg-black/60 rounded-full px-2 py-0.5 backdrop-blur-sm">
                    <MessageCircle className="w-3 h-3 text-blue-400" />
                    <span className="text-[10px] font-semibold text-white">{formatNumber(post.commentsCount)}</span>
                  </div>
                )}
                {post.saved != null && (
                  <div className="flex items-center gap-1 bg-black/60 rounded-full px-2 py-0.5 backdrop-blur-sm">
                    <Bookmark className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                    <span className="text-[10px] font-semibold text-white">{formatNumber(post.saved)}</span>
                  </div>
                )}
                {post.shares != null && (
                  <div className="flex items-center gap-1 bg-black/60 rounded-full px-2 py-0.5 backdrop-blur-sm">
                    <Share2 className="w-3 h-3 text-green-400" />
                    <span className="text-[10px] font-semibold text-white">{formatNumber(post.shares)}</span>
                  </div>
                )}
                {avgWatchSec != null && (
                  <div className="flex items-center gap-1 bg-orange-500/70 rounded-full px-2 py-0.5 backdrop-blur-sm">
                    <Clock className="w-3 h-3 text-white" />
                    <span className="text-[10px] font-semibold text-white">{avgWatchSec}s</span>
                  </div>
                )}
                {replayRate != null && parseFloat(replayRate) > 1 && (
                  <div className="flex items-center gap-1 bg-violet-500/70 rounded-full px-2 py-0.5 backdrop-blur-sm">
                    <Play className="w-2.5 h-2.5 text-white fill-white" />
                    <span className="text-[10px] font-semibold text-white">{replayRate}x</span>
                  </div>
                )}

                {/* ── Link platform pill — prominent in overlay ── */}
                {post.linkUrl && linkPlatform && (
                  <div
                    className={`flex items-center gap-1 ${linkPlatform.color} border border-white/20 rounded-full px-2 py-0.5 backdrop-blur-sm`}
                  >
                    {linkLogoSrc ? (
                      <Image
                        src={linkLogoSrc}
                        alt={linkPlatform.label}
                        width={10}
                        height={10}
                        className={`object-contain ${
                          linkPlatformKey && PLATFORM_LOGO_INVERT.has(linkPlatformKey)
                            ? "invert"
                            : ""
                        }`}
                        unoptimized
                      />
                    ) : (
                      <Link className="w-2.5 h-2.5 text-white" />
                    )}
                    <span className="text-[10px] font-semibold text-white">
                      {linkPlatform.label} link
                    </span>
                    <ExternalLink className="w-2 h-2 text-white/70" />
                  </div>
                )}

                {/* Revenue in overlay */}
                {hasRevenue && (
                  <div
                    className={`flex items-center gap-1 ${
                      attr!.platform === "ltk"
                        ? "bg-violet-600/80"
                        : attr!.platform === "shopmy"
                        ? "bg-pink-600/80"
                        : "bg-emerald-600/80"
                    } rounded-full px-2 py-0.5 backdrop-blur-sm`}
                  >
                    <DollarSign className="w-3 h-3 text-white" />
                    <span className="text-[10px] font-semibold text-white">
                      {formatCurrency(attr!.commission)} comm
                    </span>
                  </div>
                )}
                {hasRevenue && attr!.clicks > 0 && (
                  <div className="flex items-center gap-1 bg-black/60 rounded-full px-2 py-0.5 backdrop-blur-sm">
                    <MousePointerClick className="w-3 h-3 text-emerald-400" />
                    <span className="text-[10px] font-semibold text-white">
                      {formatNumber(attr!.clicks)} clicks
                    </span>
                  </div>
                )}
              </div>

              {/* Date strip at bottom of overlay */}
              {post.postedAt && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                  <p className="text-[9px] text-gray-300 text-center">
                    {new Date(post.postedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
              )}
            </div>
          </a>
        );
      })}
    </div>
  );
}
