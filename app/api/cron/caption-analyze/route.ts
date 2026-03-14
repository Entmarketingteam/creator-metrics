import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { captionAnalysis, mediaSnapshots, creators } from "@/lib/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import crypto from "crypto";

const AGENT_SERVER = "https://ent-agent-server-production.up.railway.app";
const BATCH_SIZE = 30;

function captionHash(caption: string): string {
  return crypto.createHash("sha256").update(caption ?? "").digest("hex").slice(0, 16);
}

async function analyzeCaption(
  mediaIgId: string,
  creatorId: string,
  caption: string
) {
  const prompt = `You are analyzing an Instagram caption for SEO and engagement optimization.
Analyze this caption and return a JSON object with these fields:
- seo_score: integer 0-100
- seo_breakdown: object with keys hook_quality(0-20), keyword_relevance(0-25), hashtag_efficiency(0-15), cta_quality(0-15), brand_mentions(0-10), alt_text_flag(0-10), engagement_mechanics(0-5)
- hook_text: first 125 characters of caption
- hook_quality_label: "strong" | "moderate" | "weak"
- hashtag_quality: "optimal" | "over_limit" | "none"
- cta_type: "dm" | "link_bio" | "none"
- intent: one of sale_promotion|product_showcase|lifestyle|entertainment|educational|call_to_action|personal_story|trend_moment
- tone: casual|excited|informative|humorous|aspirational
- hook_type: discount|trend|relatable_humor|aspiration|education|challenge|personal_story|product_reveal
- key_topics: array of 2-4 strings
- product_category: fashion|fitness|home|beauty|food|travel|lifestyle|kids|other
- has_urgency: boolean
- virality_signals: array of 0-3 from relatable|funny|inspiring|informative|controversial|satisfying
- recommendations: array of 2-3 actionable strings

Caption: ${caption}

Return ONLY valid JSON, no markdown.`;

  const res = await fetch(`${AGENT_SERVER}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) throw new Error(`Agent server ${res.status}`);
  const { result } = await res.json();

  let parsed: Record<string, unknown>;
  try {
    const clean = result.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
    parsed = JSON.parse(clean);
  } catch {
    throw new Error("Failed to parse agent response as JSON");
  }

  return parsed;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get active creators
  const allCreators = await db
    .select({ id: creators.id })
    .from(creators)
    .where(eq(creators.isOwned, true));

  const creatorIds = allCreators.map((c) => c.id);
  if (!creatorIds.length) {
    return NextResponse.json({ processed: 0, message: "No owned creators" });
  }

  // Find posts not yet analyzed or with stale caption hash
  const toAnalyze = await db
    .select({
      mediaIgId: mediaSnapshots.mediaIgId,
      creatorId: mediaSnapshots.creatorId,
      caption:   mediaSnapshots.caption,
      existingHash: sql<string | null>`
        (SELECT caption_hash FROM caption_analysis ca
         WHERE ca.media_ig_id = ${mediaSnapshots.mediaIgId}
           AND ca.creator_id = ${mediaSnapshots.creatorId}
         LIMIT 1)
      `,
    })
    .from(mediaSnapshots)
    .where(inArray(mediaSnapshots.creatorId, creatorIds))
    .limit(BATCH_SIZE * 2);

  const pending = toAnalyze
    .filter((row) => {
      if (!row.caption) return false;
      const hash = captionHash(row.caption);
      return !row.existingHash || row.existingHash !== hash;
    })
    .slice(0, BATCH_SIZE);

  let processed = 0;
  let errors = 0;

  for (const row of pending) {
    try {
      const hash = captionHash(row.caption!);
      const analysis = await analyzeCaption(row.mediaIgId, row.creatorId, row.caption!);

      await db
        .insert(captionAnalysis)
        .values({
          mediaIgId:        row.mediaIgId,
          creatorId:        row.creatorId,
          captionHash:      hash,
          seoScore:         (analysis.seo_score as number) ?? null,
          seoBreakdown:     analysis.seo_breakdown ?? null,
          hookText:         (analysis.hook_text as string) ?? null,
          hookQualityLabel: (analysis.hook_quality_label as string) ?? null,
          hashtagQuality:   (analysis.hashtag_quality as string) ?? null,
          ctaType:          (analysis.cta_type as string) ?? null,
          intent:           (analysis.intent as string) ?? null,
          tone:             (analysis.tone as string) ?? null,
          hookType:         (analysis.hook_type as string) ?? null,
          keyTopics:        analysis.key_topics ?? null,
          productCategory:  (analysis.product_category as string) ?? null,
          hasUrgency:       (analysis.has_urgency as boolean) ?? false,
          viralitySignals:  analysis.virality_signals ?? null,
          recommendations:  analysis.recommendations ?? null,
        })
        .onConflictDoUpdate({
          target: [captionAnalysis.mediaIgId, captionAnalysis.creatorId],
          set: {
            captionHash:      hash,
            seoScore:         (analysis.seo_score as number) ?? null,
            seoBreakdown:     analysis.seo_breakdown ?? null,
            hookText:         (analysis.hook_text as string) ?? null,
            hookQualityLabel: (analysis.hook_quality_label as string) ?? null,
            hashtagQuality:   (analysis.hashtag_quality as string) ?? null,
            ctaType:          (analysis.cta_type as string) ?? null,
            intent:           (analysis.intent as string) ?? null,
            tone:             (analysis.tone as string) ?? null,
            hookType:         (analysis.hook_type as string) ?? null,
            keyTopics:        analysis.key_topics ?? null,
            productCategory:  (analysis.product_category as string) ?? null,
            hasUrgency:       (analysis.has_urgency as boolean) ?? false,
            viralitySignals:  analysis.virality_signals ?? null,
            recommendations:  analysis.recommendations ?? null,
            analyzedAt:       new Date(),
          },
        });

      processed++;
    } catch (err) {
      console.error(`Failed to analyze ${row.mediaIgId}:`, err);
      errors++;
    }
  }

  return NextResponse.json({ processed, errors, total: pending.length });
}
