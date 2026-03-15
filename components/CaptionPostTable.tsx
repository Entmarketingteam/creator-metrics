import type { CaptionPost } from "@/lib/caption-queries";

const HOOK_COLORS: Record<string, string> = {
  strong:   "text-green-400",
  moderate: "text-yellow-400",
  weak:     "text-red-400",
};

function ScoreBadge({ score }: { score: number | null }) {
  const s = score ?? 0;
  const cls =
    s >= 75 ? "text-green-400 bg-green-900/30" :
    s >= 50 ? "text-yellow-400 bg-yellow-900/30" :
              "text-red-400 bg-red-900/30";
  return (
    <span className={`text-xs font-bold px-2 py-1 rounded-full ${cls}`}>
      {score ?? "—"}
    </span>
  );
}

export function CaptionPostTable({ posts }: { posts: CaptionPost[] }) {
  if (!posts.length) {
    return <p className="text-gray-500 text-sm">No analyzed captions yet. Run the analyzer to get started.</p>;
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800">
            <th className="text-left px-4 py-3 text-gray-500 font-medium">Caption</th>
            <th className="text-left px-4 py-3 text-gray-500 font-medium">SEO</th>
            <th className="text-left px-4 py-3 text-gray-500 font-medium">Hook</th>
            <th className="text-left px-4 py-3 text-gray-500 font-medium">Hashtags</th>
            <th className="text-left px-4 py-3 text-gray-500 font-medium">CTA</th>
            <th className="text-left px-4 py-3 text-gray-500 font-medium">Intent</th>
            <th className="text-right px-4 py-3 text-gray-500 font-medium">Saves</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => {
            const label = post.hookQualityLabel ?? "weak";
            return (
              <tr key={post.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                <td className="px-4 py-3 text-gray-300 max-w-xs">
                  <p className="truncate">{post.caption ?? "—"}</p>
                </td>
                <td className="px-4 py-3">
                  <ScoreBadge score={post.seoScore} />
                </td>
                <td className={`px-4 py-3 capitalize ${HOOK_COLORS[label] ?? "text-gray-400"}`}>{label}</td>
                <td className="px-4 py-3 text-gray-400 capitalize">{post.hashtagQuality ?? "—"}</td>
                <td className="px-4 py-3 text-gray-400 capitalize">{post.ctaType ?? "—"}</td>
                <td className="px-4 py-3 text-gray-400 capitalize">
                  {post.intent?.replace(/_/g, " ") ?? "—"}
                </td>
                <td className="px-4 py-3 text-right text-gray-400">
                  {post.saves != null ? post.saves.toLocaleString() : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
