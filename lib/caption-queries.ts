import { db } from "@/lib/db";
import { captionAnalysis, mediaSnapshots } from "@/lib/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export type CaptionPost = {
  id: number;
  mediaIgId: string;
  creatorId: string;
  seoScore: number | null;
  hookQualityLabel: string | null;
  hashtagQuality: string | null;
  ctaType: string | null;
  intent: string | null;
  hookType: string | null;
  analyzedAt: Date;
  caption: string | null;
  saves: number | null;
};

export type ScoreDistribution = {
  "0-25": number;
  "26-50": number;
  "51-75": number;
  "76-100": number;
};

export async function getCaptionStats(
  creatorId: string
): Promise<{ totalAnalyzed: number; avgScore: number }> {
  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      avg:   sql<number>`ROUND(AVG(${captionAnalysis.seoScore}))`,
    })
    .from(captionAnalysis)
    .where(eq(captionAnalysis.creatorId, creatorId));
  return {
    totalAnalyzed: Number(row?.total ?? 0),
    avgScore:      Number(row?.avg ?? 0),
  };
}

export async function getCaptionScoreDistribution(
  creatorId: string
): Promise<ScoreDistribution> {
  const rows = await db
    .select({ seoScore: captionAnalysis.seoScore })
    .from(captionAnalysis)
    .where(eq(captionAnalysis.creatorId, creatorId));

  const dist: ScoreDistribution = { "0-25": 0, "26-50": 0, "51-75": 0, "76-100": 0 };
  for (const { seoScore } of rows) {
    const s = seoScore ?? 0;
    if (s <= 25) dist["0-25"]++;
    else if (s <= 50) dist["26-50"]++;
    else if (s <= 75) dist["51-75"]++;
    else dist["76-100"]++;
  }
  return dist;
}

export async function getTopCaptionIssues(
  creatorId: string
): Promise<string[]> {
  const rows = await db
    .select({ seoBreakdown: captionAnalysis.seoBreakdown })
    .from(captionAnalysis)
    .where(eq(captionAnalysis.creatorId, creatorId));

  const dimTotals: Record<string, number> = {};
  const dimMax: Record<string, number> = {
    hook_quality: 20, keyword_relevance: 25, hashtag_efficiency: 15,
    cta_quality: 15, brand_mentions: 10, alt_text_flag: 10, engagement_mechanics: 5,
  };

  let n = 0;
  for (const { seoBreakdown } of rows) {
    if (!seoBreakdown || typeof seoBreakdown !== "object") continue;
    const bd = seoBreakdown as Record<string, number>;
    n++;
    for (const [dim, maxPts] of Object.entries(dimMax)) {
      const earned = bd[dim] ?? 0;
      dimTotals[dim] = (dimTotals[dim] ?? 0) + earned / maxPts;
    }
  }

  if (!n) return [];
  const avgFill = Object.entries(dimTotals).map(([d, total]) => ({
    dim: d,
    avg: total / n,
  }));
  return avgFill
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 3)
    .map((x) => x.dim);
}

export async function getCaptionPosts(
  creatorId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<CaptionPost[]> {
  const { limit = 25, offset = 0 } = opts;

  // Use a correlated subquery to fetch only the latest snapshot per post,
  // avoiding fan-out from multiple captured_at dates in media_snapshots.
  const rows = await db.execute(sql`
    SELECT
      ca.id,
      ca.media_ig_id     AS "mediaIgId",
      ca.creator_id      AS "creatorId",
      ca.seo_score       AS "seoScore",
      ca.hook_quality_label AS "hookQualityLabel",
      ca.hashtag_quality AS "hashtagQuality",
      ca.cta_type        AS "ctaType",
      ca.intent,
      ca.hook_type       AS "hookType",
      ca.analyzed_at     AS "analyzedAt",
      ms.caption,
      ms.saved           AS saves
    FROM caption_analysis ca
    LEFT JOIN LATERAL (
      SELECT caption, saved
      FROM media_snapshots
      WHERE media_ig_id = ca.media_ig_id
        AND creator_id  = ca.creator_id
      ORDER BY captured_at DESC
      LIMIT 1
    ) ms ON true
    WHERE ca.creator_id = ${creatorId}
    ORDER BY ca.seo_score DESC NULLS LAST
    LIMIT ${limit} OFFSET ${offset}
  `);

  return Array.from(rows) as CaptionPost[];
}

export async function getCaptionPrescription(
  creatorId: string
): Promise<string[]> {
  const issues = await getTopCaptionIssues(creatorId);

  const prescriptionMap: Record<string, string> = {
    hook_quality:         "Lead with a niche keyword in your first 125 characters — that's your Google meta description.",
    keyword_relevance:    "Include 3–5 fashion/lifestyle keywords in every caption to improve discoverability.",
    hashtag_efficiency:   "Use exactly 1–5 targeted hashtags. Posts with > 5 hashtags are algorithmically suppressed.",
    cta_quality:          "Switch from 'link in bio' to 'DM me for the link' — DM CTAs convert 2–3× better.",
    brand_mentions:       "Tag the brand (@brandname) in your caption to appear in brand search results.",
    alt_text_flag:        "Describe what you're wearing/showing in the caption — IG uses this for accessibility indexing.",
    engagement_mechanics: "End with a question or 'save this post' prompt to boost saves (saves = strongest revenue signal).",
  };

  const prescriptions = issues
    .filter((d) => prescriptionMap[d])
    .map((d) => prescriptionMap[d]);

  const savesTip = prescriptionMap["engagement_mechanics"];
  if (!prescriptions.includes(savesTip)) prescriptions.push(savesTip);
  return prescriptions;
}
