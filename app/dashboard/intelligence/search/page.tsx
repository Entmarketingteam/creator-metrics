"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

const FILTER_CHIPS = [
  { label: "All",      mediaProductType: undefined, mediaType: undefined },
  { label: "Reels",    mediaProductType: "REELS",   mediaType: undefined },
  { label: "Feed",     mediaProductType: "FEED",    mediaType: undefined },
  { label: "Carousel", mediaProductType: "FEED",    mediaType: "CAROUSEL_ALBUM" },
];

export default function SearchPage() {
  const searchParams = useSearchParams();
  const creatorId    = searchParams.get("creatorId") ?? "nicki_entenmann";

  const [query,     setQuery]     = useState("");
  const [filter,    setFilter]    = useState(0);
  const [sortBy,    setSortBy]    = useState<"relevant" | "saves" | "reach">("relevant");
  const [results,   setResults]   = useState<any[]>([]);
  const [loading,   setLoading]   = useState(false);

  async function search() {
    if (!query.trim()) return;
    setLoading(true);
    const chip = FILTER_CHIPS[filter];
    const res  = await fetch("/api/intelligence/search", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query, creatorId, sortBy,
        mediaProductType: chip.mediaProductType,
        mediaType:        chip.mediaType,
      }),
    });
    const data = await res.json();
    setResults(data.results ?? []);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="flex gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder='Try "clean girl morning routine"…'
          className="flex-1 bg-gray-800 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm border border-gray-700 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={search}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex gap-2">
          {FILTER_CHIPS.map((chip, i) => (
            <button
              key={chip.label}
              onClick={() => setFilter(i)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === i
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {(["relevant", "saves", "reach"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors capitalize ${
                sortBy === s
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {s === "relevant" ? "Most Relevant" : `Most ${s.charAt(0).toUpperCase() + s.slice(1)}`}
            </button>
          ))}
        </div>
      </div>

      {/* Results grid */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {results.map((post) => (
            <a
              key={post.post_id}
              href={post.post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative rounded-xl overflow-hidden bg-gray-800 aspect-square"
            >
              {post.image_url && (
                <img
                  src={post.image_url}
                  alt={post.caption?.slice(0, 50)}
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                <div className="flex gap-3 text-xs text-white font-medium">
                  <span>♥ {(post.likes ?? 0).toLocaleString()}</span>
                  <span>🔖 {(post.saves ?? 0).toLocaleString()}</span>
                  <span>👁 {(post.reach ?? 0).toLocaleString()}</span>
                </div>
                {post.caption && (
                  <p className="text-xs text-gray-300 mt-1 line-clamp-2">{post.caption}</p>
                )}
              </div>
              <div className="absolute top-2 right-2 bg-black/60 rounded px-1.5 py-0.5 text-xs text-white">
                {(post.similarity * 100).toFixed(0)}%
              </div>
            </a>
          ))}
        </div>
      )}

      {results.length === 0 && !loading && query && (
        <p className="text-gray-500 text-sm text-center py-12">No results. Try a different query.</p>
      )}
    </div>
  );
}
