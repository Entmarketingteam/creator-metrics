import { db } from "@/lib/db";
import {
  contentReports,
  contentPostsScored,
  contentIgAnalyzed,
  creators,
} from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, FlaskConical, TrendingUp, FileText } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import PlatformBadge from "@/components/earnings/PlatformBadge";

export const dynamic = "force-dynamic";

async function getReportDetail(id: number) {
  const rows = await db
    .select({
      report: contentReports,
      creator: {
        id: creators.id,
        username: creators.username,
        displayName: creators.displayName,
      },
    })
    .from(contentReports)
    .leftJoin(creators, eq(contentReports.creatorId, creators.id))
    .where(eq(contentReports.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function getScoredPosts(reportId: number) {
  return db
    .select()
    .from(contentPostsScored)
    .where(eq(contentPostsScored.reportId, reportId))
    .orderBy(desc(contentPostsScored.overallScore));
}

async function getIgAnalyzed(reportId: number) {
  return db
    .select()
    .from(contentIgAnalyzed)
    .where(eq(contentIgAnalyzed.reportId, reportId));
}

function avg(nums: (number | null | undefined)[]): number | null {
  const valid = nums.filter((n): n is number => n != null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function ScoreBar({ score }: { score: number | null | undefined }) {
  const s = score ?? 0;
  const color =
    s >= 75 ? "bg-emerald-500" : s >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${s}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-6 text-right">{score ?? "—"}</span>
    </div>
  );
}

export default async function ContentLabDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const reportId = parseInt(rawId, 10);
  if (isNaN(reportId)) notFound();

  const [detail, scoredPosts, igAnalyzed] = await Promise.all([
    getReportDetail(reportId),
    getScoredPosts(reportId),
    getIgAnalyzed(reportId),
  ]);

  if (!detail) notFound();

  const { report, creator } = detail;
  const creatorName = creator?.displayName ?? creator?.username ?? "Creator";

  // KPI calculations
  const totalPosts = scoredPosts.length;
  const avgOverall = avg(scoredPosts.map((p) => p.overallScore));
  const avgEngagement = avg(scoredPosts.map((p) => p.engagementScore));
  const avgRevenue = avg(scoredPosts.map((p) => p.revenueScore));

  // Top 12 posts
  const topPosts = scoredPosts.slice(0, 12);

  // Caption Intelligence KPIs
  const hasCaptionData = igAnalyzed.length > 0;
  const avgSeo = avg(igAnalyzed.map((p) => p.seoScore));
  const strongHooks = igAnalyzed.filter((p) => p.hookQualityLabel === "strong").length;
  const pctStrongHooks =
    igAnalyzed.length > 0 ? Math.round((strongHooks / igAnalyzed.length) * 100) : 0;
  const dmCtaPosts = igAnalyzed.filter((p) => {
    const fa = p.fullAnalysis as Record<string, unknown> | null;
    if (!fa) return false;
    const cta = fa.cta_type as string | undefined;
    return cta?.toLowerCase().includes("dm") ?? false;
  }).length;
  const pctDmCta =
    igAnalyzed.length > 0 ? Math.round((dmCtaPosts / igAnalyzed.length) * 100) : 0;

  // Intent breakdown
  const intentMap: Record<string, { count: number; saves: number; likes: number }> = {};
  for (const p of igAnalyzed) {
    if (!p.intent) continue;
    if (!intentMap[p.intent]) intentMap[p.intent] = { count: 0, saves: 0, likes: 0 };
    intentMap[p.intent].count++;
    intentMap[p.intent].saves += p.saves ?? 0;
    intentMap[p.intent].likes += p.likes ?? 0;
  }
  const intentRows = Object.entries(intentMap)
    .map(([intent, data]) => ({
      intent,
      count: data.count,
      avgSaves: data.count > 0 ? Math.round(data.saves / data.count) : 0,
      avgLikes: data.count > 0 ? Math.round(data.likes / data.count) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/content-lab"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Content Lab
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <FlaskConical className="w-6 h-6 text-purple-400 shrink-0" />
            <div>
              <h1 className="text-2xl font-bold text-white">{creatorName}</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Content Lab Report
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-purple-600/20 text-purple-300 border border-purple-600/30 text-sm font-semibold px-3 py-1 rounded-full">
              {report.season} {report.year}
            </span>
            {report.generatedAt && (
              <span className="text-xs text-gray-500 bg-gray-800 px-2.5 py-1 rounded-full">
                Generated{" "}
                {new Date(report.generatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Top KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Posts Scored", value: formatNumber(totalPosts), sub: "total" },
          {
            label: "Avg Overall Score",
            value: avgOverall != null ? `${avgOverall}` : "—",
            sub: "out of 100",
          },
          {
            label: "Avg Engagement Score",
            value: avgEngagement != null ? `${avgEngagement}` : "—",
            sub: "out of 100",
          },
          {
            label: "Avg Revenue Score",
            value: avgRevenue != null ? `${avgRevenue}` : "—",
            sub: "out of 100",
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="bg-gray-900 border border-gray-800 rounded-xl p-5"
          >
            <p className="text-xs text-gray-500 mb-1">{kpi.label}</p>
            <p className="text-3xl font-bold text-white">{kpi.value}</p>
            <p className="text-xs text-gray-600 mt-0.5">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Top Posts Grid */}
      {topPosts.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 border-dashed rounded-xl py-16 text-center">
          <TrendingUp className="w-8 h-8 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-medium mb-1">No posts scored yet</p>
          <p className="text-gray-600 text-sm max-w-xs mx-auto">
            Run the content pipeline to populate this report.
          </p>
        </div>
      ) : (
        <div>
          <h2 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-400" />
            Top Posts
            <span className="text-xs text-gray-500 font-normal">
              by overall score
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {topPosts.map((post) => {
              const tags = (post.tags as string[] | null) ?? [];
              const topTags = tags.slice(0, 2);
              const captionPreview = post.caption
                ? post.caption.slice(0, 80) + (post.caption.length > 80 ? "…" : "")
                : null;

              const cardContent = (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-colors">
                  {/* Hero image */}
                  {post.heroImage ? (
                    <div className="relative h-40 bg-gray-800">
                      <Image
                        src={post.heroImage}
                        alt={captionPreview ?? "Post image"}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                  ) : (
                    <div className="h-40 bg-gray-800 flex items-center justify-center">
                      <span className="text-gray-600 text-xs">No image</span>
                    </div>
                  )}

                  <div className="p-4 space-y-3">
                    {/* Platform + Tags row */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <PlatformBadge platform={post.platform} />
                      {topTags.map((tag) => (
                        <span
                          key={tag}
                          className="bg-gray-800 text-gray-400 text-xs px-2 py-0.5 rounded-full"
                        >
                          {tag.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>

                    {/* Scores */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-0.5">
                        <span>Overall</span>
                        <span>Engage</span>
                        <span>Revenue</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-bold w-8 shrink-0 ${
                            (post.overallScore ?? 0) >= 75
                              ? "text-emerald-400"
                              : (post.overallScore ?? 0) >= 50
                              ? "text-yellow-400"
                              : "text-red-400"
                          }`}
                        >
                          {post.overallScore ?? "—"}
                        </span>
                        <div className="flex-1 flex gap-2">
                          <ScoreBar score={post.engagementScore} />
                          <ScoreBar score={post.revenueScore} />
                        </div>
                      </div>
                    </div>

                    {/* Caption preview */}
                    {captionPreview && (
                      <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
                        {captionPreview}
                      </p>
                    )}
                  </div>
                </div>
              );

              return post.postUrl ? (
                <a
                  key={post.id}
                  href={post.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {cardContent}
                </a>
              ) : (
                <div key={post.id}>{cardContent}</div>
              );
            })}
          </div>
        </div>
      )}

      {/* Caption Intelligence Panel */}
      {hasCaptionData && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-400" />
            Caption Intelligence
            <span className="text-xs text-gray-500 font-normal">
              {igAnalyzed.length} posts analyzed
            </span>
          </h2>

          {/* Caption KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gray-800/60 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">Avg SEO Score</p>
              <p className="text-2xl font-bold text-white">
                {avgSeo != null ? avgSeo : "—"}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">out of 100</p>
            </div>
            <div className="bg-gray-800/60 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">Strong Hooks</p>
              <p className="text-2xl font-bold text-white">{pctStrongHooks}%</p>
              <p className="text-xs text-gray-600 mt-0.5">
                {strongHooks} of {igAnalyzed.length} posts
              </p>
            </div>
            <div className="bg-gray-800/60 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">DM CTA Posts</p>
              <p className="text-2xl font-bold text-white">{pctDmCta}%</p>
              <p className="text-xs text-gray-600 mt-0.5">
                {dmCtaPosts} of {igAnalyzed.length} posts
              </p>
            </div>
          </div>

          {/* Intent breakdown table */}
          {intentRows.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-400 mb-3">Intent Breakdown</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-800">
                      <th className="text-left pb-2 font-medium">Intent</th>
                      <th className="text-right pb-2 font-medium">Posts</th>
                      <th className="text-right pb-2 font-medium">Avg Saves</th>
                      <th className="text-right pb-2 font-medium">Avg Likes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {intentRows.map((row) => (
                      <tr key={row.intent} className="text-gray-300">
                        <td className="py-2.5 capitalize">{row.intent.replace(/_/g, " ")}</td>
                        <td className="py-2.5 text-right text-gray-400">{row.count}</td>
                        <td className="py-2.5 text-right text-gray-400">
                          {formatNumber(row.avgSaves)}
                        </td>
                        <td className="py-2.5 text-right text-gray-400">
                          {formatNumber(row.avgLikes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Raw Report Data (collapsible) */}
      <details className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <summary className="px-5 py-4 text-sm font-medium text-gray-400 cursor-pointer hover:text-gray-200 transition-colors list-none flex items-center gap-2 select-none">
          <FileText className="w-4 h-4 text-gray-600" />
          Raw Report Data
          <span className="ml-auto text-xs text-gray-600">click to expand</span>
        </summary>
        <div className="border-t border-gray-800 p-4">
          <pre className="text-xs text-gray-500 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed max-h-[600px] overflow-y-auto">
            {JSON.stringify(report.reportData, null, 2)}
          </pre>
        </div>
      </details>
    </div>
  );
}
