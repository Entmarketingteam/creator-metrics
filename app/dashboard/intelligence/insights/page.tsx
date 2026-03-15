import { auth } from "@clerk/nextjs/server";
import { getTodayAnalysis } from "@/lib/intelligence-queries";
import { getCreatorScope } from "@/lib/creator-scope";
import { InsightsChat } from "./InsightsChat";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: { creatorId?: string };
}) {
  const { userId, sessionClaims } = await auth();
  const role = (sessionClaims?.publicMetadata as any)?.role as string | undefined;

  let creatorId = "nicki_entenmann";
  try {
    ({ creatorId } = await getCreatorScope(userId!, role, searchParams.creatorId));
  } catch {}

  const analysis = await getTodayAnalysis(creatorId);
  const data = analysis?.analysis as any;

  return (
    <div className="space-y-8">
      {!data ? (
        <div className="text-gray-500 text-sm py-12 text-center">
          No analysis yet. Check back after the daily cron runs.
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-600">
            Analysis from {new Date(analysis!.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
          {/* Engagement trend */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 col-span-1">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Trend</p>
              <p className={`text-2xl font-bold capitalize ${
                data.engagementTrend === "improving" ? "text-green-400" :
                data.engagementTrend === "declining" ? "text-red-400" : "text-yellow-400"
              }`}>
                {data.engagementTrend}
              </p>
              <p className="text-sm text-gray-400 mt-2">{data.trendNote}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Best Days</p>
              <p className="text-white font-medium">{data.bestPostingDays?.join(", ") ?? "—"}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Top Content Type</p>
              <p className="text-white font-medium">{data.byContentType?.[0]?.type ?? "—"}</p>
              <p className="text-sm text-gray-400">avg reach {data.byContentType?.[0]?.avgReach?.toLocaleString() ?? "—"}</p>
            </div>
          </div>

          {/* Top themes */}
          <div>
            <h2 className="text-white font-semibold mb-3">Top Themes (Last 90 Days)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.themes?.map((theme: any) => (
                <div key={theme.name} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <p className="text-white font-medium">{theme.name}</p>
                  <div className="flex gap-4 mt-2 text-sm text-gray-400">
                    <span>👁 {theme.avgReach?.toLocaleString()}</span>
                    <span>🔖 {theme.avgSaves?.toLocaleString()}</span>
                    <span>{theme.postCount} posts</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Hidden gems */}
          {data.hiddenGems?.length > 0 && (
            <div>
              <h2 className="text-white font-semibold mb-3">Hidden Gems</h2>
              <div className="space-y-2">
                {data.hiddenGems.map((gem: any) => (
                  <a
                    key={gem.postId}
                    href={gem.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-4 bg-gray-900 rounded-xl p-4 border border-gray-800 hover:border-gray-600 transition-colors"
                  >
                    <div className="flex-1">
                      <p className="text-gray-300 text-sm line-clamp-2">{gem.caption}</p>
                    </div>
                    <div className="text-right text-sm text-gray-400 shrink-0">
                      <p>🔖 {gem.saves?.toLocaleString()}</p>
                      <p>♥ {gem.likes?.toLocaleString()}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Q&A */}
      <InsightsChat creatorId={creatorId} />
    </div>
  );
}
