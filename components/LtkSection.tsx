"use client";

import { AreaChart, BarChart } from "@tremor/react";
import Image from "next/image";
import { Flame, Grid3x3, TrendingUp } from "lucide-react";
import MetricCard from "@/components/MetricCard";
import type { LtkOverview } from "@/lib/ltk";

interface LtkSectionProps {
  overview: LtkOverview;
}

export default function LtkSection({ overview }: LtkSectionProps) {
  const postsByDay = overview.posts_per_day.map((d) => ({
    date: d.date,
    Posts: d.count,
  }));

  const topRetailers = overview.top_retailers.map((r) => ({
    retailer: r.name,
    Posts: r.count,
  }));

  return (
    <section className="mb-10 space-y-6">
      <div className="flex items-center gap-2">
        <Flame className="w-4 h-4 text-pink-400" />
        <h2 className="text-lg font-semibold text-white">
          LTK Activity (Last 30 Days)
        </h2>
        <span className="text-xs text-gray-500 ml-auto">
          Powered by ent-dashboard-scaffold
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="LTK Posts (30d)"
          value={overview.posts_count}
          icon={<Grid3x3 className="w-4 h-4" />}
        />
        <MetricCard
          title="Avg LTK Posts / Week"
          value={overview.avg_posts_per_week}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <MetricCard
          title="Top LTK Retailer"
          value={overview.top_retailer}
          icon={<Flame className="w-4 h-4" />}
        />
        <MetricCard
          title="Products Linked"
          value={overview.total_products}
          icon={<Grid3x3 className="w-4 h-4" />}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <p className="text-sm font-semibold text-gray-400 mb-3">
            Posting Activity
          </p>
          <AreaChart
            data={postsByDay}
            index="date"
            categories={["Posts"]}
            colors={["pink"]}
            showAnimation
            className="h-56"
          />
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <p className="text-sm font-semibold text-gray-400 mb-3">
            Top Retailers
          </p>
          <BarChart
            data={topRetailers}
            index="retailer"
            categories={["Posts"]}
            colors={["gray"]}
            valueFormatter={(v: number) => v.toString()}
            showAnimation
            className="h-56"
          />
        </div>
      </div>

      {/* Recent LTK posts grid */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Grid3x3 className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-300">
            Recent LTK Posts
          </h3>
        </div>
        {overview.recent_posts.length === 0 ? (
          <p className="text-sm text-gray-500">
            No LTK posts in the last 30 days.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {overview.recent_posts.map((post) => (
              <a
                key={post.id}
                href={post.share_url}
                target="_blank"
                rel="noopener noreferrer"
                className="group rounded-lg overflow-hidden bg-gray-900 border border-gray-800"
              >
                <div className="relative aspect-square bg-gray-800">
                  {post.hero_image ? (
                    <Image
                      src={post.hero_image}
                      alt={post.caption ?? "LTK post"}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform"
                      sizes="(max-width: 768px) 50vw, 200px"
                      unoptimized
                    />
                  ) : null}
                </div>
                <div className="p-2">
                  <p className="text-[10px] text-gray-400">
                    {new Date(post.date_published).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="text-xs text-gray-200 line-clamp-2 mt-1">
                    {post.caption || "View on LTK"}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {post.product_count} products linked
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

