import { db } from "@/lib/db";
import { contentReports, creators } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { FlaskConical, Calendar, TrendingUp } from "lucide-react";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const SEASONS = ["Q1", "Q2", "Q3", "Q4", "H1", "H2", "full_year"] as const;
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

async function getReports(creatorId: string) {
  return db
    .select({
      id:          contentReports.id,
      season:      contentReports.season,
      year:        contentReports.year,
      generatedAt: contentReports.generatedAt,
    })
    .from(contentReports)
    .where(eq(contentReports.creatorId, creatorId))
    .orderBy(desc(contentReports.generatedAt))
    .limit(20);
}

async function getCreatorList() {
  return db
    .select({ id: creators.id, username: creators.username, displayName: creators.displayName })
    .from(creators)
    .where(eq(creators.isOwned, true));
}

export default async function ContentLabPage({
  searchParams,
}: {
  searchParams: Promise<{ creatorId?: string; season?: string; year?: string }>;
}) {
  const params = await searchParams;
  const { sessionClaims } = await auth();
  const role = (sessionClaims?.publicMetadata as any)?.role as string | undefined;

  const creatorList = role === "admin" ? await getCreatorList() : [];
  const defaultCreatorId = params.creatorId ?? creatorList[0]?.id ?? "nicki_entenmann";
  const selectedSeason = params.season ?? "Q1";
  const selectedYear = parseInt(params.year ?? String(CURRENT_YEAR), 10);

  const reports = await getReports(defaultCreatorId);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FlaskConical className="w-6 h-6 text-purple-400" />
            <h1 className="text-2xl font-bold text-white">Content Lab</h1>
          </div>
          <p className="text-gray-500 text-sm">
            AI-generated content intelligence reports — scored posts, caption analysis, and seasonal trends.
          </p>
        </div>
      </div>

      {/* Season / Year selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="text-sm text-gray-400 font-medium">Season</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {SEASONS.map((s) => (
            <a
              key={s}
              href={`?creatorId=${defaultCreatorId}&season=${s}&year=${selectedYear}`}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedSeason === s
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {s}
            </a>
          ))}
        </div>
        <div className="flex gap-2 ml-auto">
          {YEARS.map((y) => (
            <a
              key={y}
              href={`?creatorId=${defaultCreatorId}&season=${selectedSeason}&year=${y}`}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedYear === y
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {y}
            </a>
          ))}
        </div>
      </div>

      {/* Report list or empty state */}
      {reports.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 border-dashed rounded-xl py-20 text-center">
          <FlaskConical className="w-10 h-10 text-gray-700 mx-auto mb-4" />
          <p className="text-gray-400 font-medium mb-1">No reports yet</p>
          <p className="text-gray-600 text-sm max-w-xs mx-auto">
            Run the content intelligence pipeline to generate your first report for this creator.
          </p>
          <code className="mt-4 inline-block bg-gray-800 text-gray-400 text-xs rounded-lg px-4 py-2">
            POST /api/content-lab/upload-report
          </code>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {reports.map((r) => (
            <div
              key={r.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                  <span className="text-white font-semibold">
                    {r.season} {r.year}
                  </span>
                </div>
                <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                  #{r.id}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Generated{" "}
                {r.generatedAt
                  ? new Date(r.generatedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "—"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
