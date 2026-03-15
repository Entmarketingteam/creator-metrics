import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { captionAnalysis, mediaSnapshots, creators } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import crypto from "crypto";

const AGENT_SERVER = "https://ent-agent-server-production.up.railway.app";
const BATCH_SIZE = 24;
const CONCURRENCY = 6;

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

  const agentKey = process.env.AGENT_SERVER_API_KEY;
  const res = await fetch(`${AGENT_SERVER}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(agentKey ? { Authorization: `Bearer ${agentKey}` } : {}),
    },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) throw new Error(`Agent server ${res.status}`);
  const data = await res.json();
  const result = data.text ?? data.result ?? "";

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

  // Find unanalyzed posts: one row per (media_ig_id, creator_id) with no existing analysis
  const pendingRows = await db.execute(sql`
    SELECT DISTINCT ON (ms.media_ig_id, ms.creator_id)
      ms.media_ig_id AS "mediaIgId",
      ms.creator_id  AS "creatorId",
      ms.caption
    FROM media_snapshots ms
    WHERE ms.creator_id = ANY(${creatorIds})
      AND ms.caption IS NOT NULL
      AND ms.caption != ''
      AND NOT EXISTS (
        SELECT 1 FROM caption_analysis ca
        WHERE ca.media_ig_id = ms.media_ig_id
          AND ca.creator_id  = ms.creator_id
      )
    ORDER BY ms.media_ig_id, ms.creator_id, ms.captured_at DESC
    LIMIT ${BATCH_SIZE}
  `) as any;

  const pending = (Array.from(pendingRows) as Array<{
    mediaIgId: string;
    creatorId: string;
    caption: string;
  }>).filter((r) => r.caption);

  let processed = 0;
  let errors = 0;

  async function processOne(row: typeof pending[number]) {
    const hash = captionHash(row.caption);
    const analysis = await analyzeCaption(row.mediaIgId, row.creatorId, row.caption);
    const values = {
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
    };
    await db
      .insert(captionAnalysis)
      .values(values)
      .onConflictDoUpdate({
        target: [captionAnalysis.mediaIgId, captionAnalysis.creatorId],
        set: { ...values, analyzedAt: new Date() },
      });
  }

  // Process in parallel batches of CONCURRENCY to stay under 30s Vercel timeout
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((row) => processOne(row)));
    for (const r of results) {
      if (r.status === "fulfilled") processed++;
      else {
        console.error("Caption analysis failed:", r.reason);
        errors++;
      }
    }
  }

  return NextResponse.json({ processed, errors, total: pending.length });
}
