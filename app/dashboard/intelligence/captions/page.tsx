import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
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

  const [dist, issues, posts, prescriptions] = await Promise.all([
    getCaptionScoreDistribution(creatorId),
    getTopCaptionIssues(creatorId),
    getCaptionPosts(creatorId, { limit: 25 }),
    getCaptionPrescription(creatorId),
  ]);

  const avgScore =
    posts.length > 0
      ? Math.round(
          posts.reduce((s, p) => s + (p.seoScore ?? 0), 0) / posts.length
        )
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-500 text-sm">
            Avg SEO Score:{" "}
            <span className="text-white font-semibold">{avgScore}/100</span>
            {" "}· {posts.length} analyzed
          </p>
        </div>
        <ReanalyzeButton creatorId={creatorId} />
      </div>

      <CaptionScoreHistogram dist={dist} />

      <PrescriptionPanel prescriptions={prescriptions} issues={issues} />

      <div>
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Analyzed Posts
        </h3>
        <Suspense fallback={<p className="text-gray-500 text-sm">Loading...</p>}>
          <CaptionPostTable posts={posts} />
        </Suspense>
      </div>
    </div>
  );
}
