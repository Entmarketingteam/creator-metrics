"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { AreaChart, BarChart } from "@tremor/react";

const PERIODS = ["7d", "30d", "90d", "all"] as const;

export default function TrendsPage() {
  const searchParams = useSearchParams();
  const creatorId    = searchParams.get("creatorId") ?? "nicki_entenmann";
  const [period, setPeriod]   = useState<typeof PERIODS[number]>("30d");
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/intelligence/trends?creatorId=${creatorId}&period=${period}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, [creatorId, period]);

  return (
    <div className="space-y-8">
      {/* Period selector */}
      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              period === p ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {p === "all" ? "All Time" : p}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center animate-pulse">Loading…</div>
      ) : (
        <>
          {/* Follower growth */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h2 className="text-white font-semibold mb-4">Follower Growth</h2>
            <AreaChart
              data={(data?.followerHistory ?? []).map((r: any) => ({
                date: r.date,
                Followers: r.followers,
              }))}
              index="date"
              categories={["Followers"]}
              colors={["blue"]}
              showLegend={false}
              className="h-48"
            />
          </div>

          {/* Engagement by type */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h2 className="text-white font-semibold mb-4">Avg Engagement by Content Type</h2>
            <BarChart
              data={(data?.engagementByType ?? []).map((r: any) => ({
                type: r.type ?? "Unknown",
                Reach: r.avg_reach ?? 0,
                Saves: r.avg_saves ?? 0,
                Shares: r.avg_shares ?? 0,
              }))}
              index="type"
              categories={["Reach", "Saves", "Shares"]}
              colors={["blue", "purple", "pink"]}
              className="h-48"
            />
          </div>

          {/* Top posts */}
          <div>
            <h2 className="text-white font-semibold mb-4">Top Posts by Saves</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {(data?.topPosts ?? []).map((post: any) => (
                <div key={post.post_id} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
                  {post.image_url && (
                    <img src={post.image_url} alt="" className="w-full aspect-square object-cover" />
                  )}
                  <div className="p-3 text-xs text-gray-400 space-y-0.5">
                    <p>🔖 {(post.saves ?? 0).toLocaleString()}</p>
                    <p>👁 {(post.reach ?? 0).toLocaleString()}</p>
                    <p className="text-gray-600">{post.posted_at?.split("T")[0]}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
