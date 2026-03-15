import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  getCaptionStats,
  getCaptionScoreDistribution,
  getTopCaptionIssues,
  getCaptionPosts,
  getCaptionPrescription,
} from "@/lib/caption-queries";
import { CaptionScoreHistogram } from "@/components/CaptionScoreHistogram";
import { CaptionPostTable }      from "@/components/CaptionPostTable";
import { PrescriptionPanel }     from "@/components/PrescriptionPanel";
import { ReanalyzeButton }       from "@/components/ReanalyzeButton";

export default async function CaptionsPage({
  searchParams,
}: {
  searchParams: { creatorId?: string };
}) {
  const creatorId = searchParams.creatorId ?? "nicki_entenmann";
  if (!creatorId) redirect("/dashboard");

  const [stats, dist, issues, posts, prescriptions] = await Promise.all([
    getCaptionStats(creatorId),
    getCaptionScoreDistribution(creatorId),
    getTopCaptionIssues(creatorId),
    getCaptionPosts(creatorId, { limit: 25 }),
    getCaptionPrescription(creatorId),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-500 text-sm">
            Avg SEO Score:{" "}
            <span className="text-white font-semibold">{stats.avgScore}/100</span>
            {" "}· {stats.totalAnalyzed.toLocaleString()} analyzed
          </p>
        </div>
        <ReanalyzeButton creatorId={creatorId} />
      </div>

      <CaptionScoreHistogram dist={dist} />

      <PrescriptionPanel prescriptions={prescriptions} issues={issues} />

      <div>
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Top Posts by SEO Score
        </h3>
        <Suspense fallback={<p className="text-gray-500 text-sm">Loading...</p>}>
          <CaptionPostTable posts={posts} />
        </Suspense>
      </div>
    </div>
  );
}
