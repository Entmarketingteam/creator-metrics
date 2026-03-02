"use client";

import Image from "next/image";
import { Heart, MessageCircle, Eye, Bookmark, Share2, Play, Clock, Link, DollarSign, MousePointerClick } from "lucide-react";
import { PLATFORM_LOGO_ICON, PLATFORM_LOGO_INVERT, formatNumber, formatCurrency } from "@/lib/utils";

function affiliatePlatform(url: string): { label: string; color: string } | null {
  if (/mavely\.app\.link|mave\.ly/.test(url)) return { label: "Mavely", color: "bg-emerald-500/80" };
  if (/ltk\.app|liketoknow\.it/.test(url)) return { label: "LTK", color: "bg-violet-500/80" };
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
}: {
  posts: Post[];
  attribution?: Record<string, PostAttribution>;
}) {
  if (posts.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>No posts collected yet. Data populates on the next cron run.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1 md:gap-3">
      {posts.map((post) => {
        const imgSrc = post.thumbnailUrl ?? post.mediaUrl;
        const isVideo = post.mediaType === "VIDEO" || post.mediaProductType === "REELS";
        const isReel = post.mediaProductType === "REELS";

        // Avg watch time in seconds (rounded to 1 decimal)
        const avgWatchSec =
          isReel && post.reelsAvgWatchTimeMs != null
            ? (post.reelsAvgWatchTimeMs / 1000).toFixed(1)
            : null;

        // Replay rate: total plays / unique viewers
        const replayRate =
          isReel && post.viewsCount != null && post.reach != null && post.reach > 0
            ? (post.viewsCount / post.reach).toFixed(1)
            : null;

        // Mavely attribution — match on linkUrl
        const attr = post.linkUrl ? attribution?.[post.linkUrl] : undefined;
        const hasRevenue = attr && attr.commission > 0;

        return (
          <a
            key={post.mediaIgId}
            href={post.permalink ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative aspect-square bg-gray-900 rounded-lg overflow-hidden"
          >
            {/* Thumbnail */}
            {imgSrc ? (
              <Image
                src={imgSrc}
                alt={post.caption?.slice(0, 60) ?? "Post"}
                fill
                className="object-cover group-hover:opacity-40 transition-opacity"
                sizes="(max-width: 768px) 33vw, 300px"
                unoptimized
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
                <span className="text-gray-600 text-xs">No preview</span>
              </div>
            )}

            {/* Video/Reel indicator */}
            {isVideo && (
              <div className="absolute top-2 right-2 z-10">
                <Play className="w-5 h-5 text-white drop-shadow-lg fill-white" />
              </div>
            )}

            {/* Type badge */}
            {post.mediaProductType && (
              <div className="absolute top-2 left-2 z-10">
                <span className="text-[10px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm">
                  {post.mediaProductType === "REELS" ? "Reel" : post.mediaProductType === "STORY" ? "Story" : "Post"}
                </span>
              </div>
            )}

            {/* Affiliate link badge — bottom-left */}
            {post.linkUrl && (() => {
              const platform = affiliatePlatform(post.linkUrl!);
              if (!platform) return null;
              const platformKey = platform.label.toLowerCase().replace(" ", "");
              const logoSrc = PLATFORM_LOGO_ICON[platformKey];
              return (
                <div className="absolute bottom-2 left-2 z-10">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${platform.color} text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm`}>
                    {logoSrc ? (
                      <Image
                        src={logoSrc}
                        alt={platform.label}
                        width={10}
                        height={10}
                        className={`object-contain ${PLATFORM_LOGO_INVERT.has(platformKey) ? "invert" : ""}`}
                        unoptimized
                      />
                    ) : (
                      <Link className="w-2.5 h-2.5" />
                    )}
                    {platform.label}
                  </span>
                </div>
              );
            })()}

            {/* Revenue attribution badge — bottom-right, always visible */}
            {hasRevenue && (
              <div className="absolute bottom-2 right-2 z-10">
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold bg-emerald-600/90 text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm">
                  <DollarSign className="w-2.5 h-2.5" />
                  {formatCurrency(attr!.commission).replace("$", "")}
                </span>
              </div>
            )}

            {/* Hover overlay with engagement bubbles */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-[1px]">
              <div className="flex flex-wrap gap-3 justify-center px-2">
                {post.likeCount != null && (
                  <div className="flex items-center gap-1 bg-black/60 rounded-full px-2.5 py-1 backdrop-blur-sm">
                    <Heart className="w-3.5 h-3.5 text-red-400 fill-red-400" />
                    <span className="text-xs font-semibold text-white">{formatNumber(post.likeCount)}</span>
                  </div>
                )}
                {post.commentsCount != null && (
                  <div className="flex items-center gap-1 bg-black/60 rounded-full px-2.5 py-1 backdrop-blur-sm">
                    <MessageCircle className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-semibold text-white">{formatNumber(post.commentsCount)}</span>
                  </div>
                )}
                {post.reach != null && (
                  <div className="flex items-center gap-1 bg-black/60 rounded-full px-2.5 py-1 backdrop-blur-sm">
                    <Eye className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-xs font-semibold text-white">{formatNumber(post.reach)}</span>
                  </div>
                )}
                {post.saved != null && (
                  <div className="flex items-center gap-1 bg-black/60 rounded-full px-2.5 py-1 backdrop-blur-sm">
                    <Bookmark className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                    <span className="text-xs font-semibold text-white">{formatNumber(post.saved)}</span>
                  </div>
                )}
                {post.shares != null && (
                  <div className="flex items-center gap-1 bg-black/60 rounded-full px-2.5 py-1 backdrop-blur-sm">
                    <Share2 className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-xs font-semibold text-white">{formatNumber(post.shares)}</span>
                  </div>
                )}
                {avgWatchSec != null && (
                  <div className="flex items-center gap-1 bg-orange-500/70 rounded-full px-2.5 py-1 backdrop-blur-sm">
                    <Clock className="w-3.5 h-3.5 text-white" />
                    <span className="text-xs font-semibold text-white">{avgWatchSec}s</span>
                  </div>
                )}
                {replayRate != null && parseFloat(replayRate) > 1 && (
                  <div className="flex items-center gap-1 bg-violet-500/70 rounded-full px-2.5 py-1 backdrop-blur-sm">
                    <Play className="w-3 h-3 text-white fill-white" />
                    <span className="text-xs font-semibold text-white">{replayRate}x</span>
                  </div>
                )}
                {/* Mavely revenue attribution — shown in hover overlay */}
                {hasRevenue && (
                  <div className="flex items-center gap-1 bg-emerald-600/80 rounded-full px-2.5 py-1 backdrop-blur-sm">
                    <DollarSign className="w-3.5 h-3.5 text-white" />
                    <span className="text-xs font-semibold text-white">{formatCurrency(attr!.commission)} comm</span>
                  </div>
                )}
                {hasRevenue && attr!.clicks > 0 && (
                  <div className="flex items-center gap-1 bg-black/60 rounded-full px-2.5 py-1 backdrop-blur-sm">
                    <MousePointerClick className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs font-semibold text-white">{formatNumber(attr!.clicks)} clicks</span>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom date strip */}
            {post.postedAt && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-[10px] text-gray-300">
                  {new Date(post.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
            )}
          </a>
        );
      })}
    </div>
  );
}
