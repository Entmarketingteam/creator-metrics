import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { captionAnalysis, mediaSnapshots } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

const AGENT_SERVER = "https://ent-agent-server-production.up.railway.app";

function captionHash(caption: string): string {
  return crypto.createHash("sha256").update(caption ?? "").digest("hex").slice(0, 16);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { creatorId, mediaIgId, forceRefresh } = body as {
    creatorId?: string;
    mediaIgId?: string;
    forceRefresh?: boolean;
  };

  if (!creatorId) {
    return NextResponse.json({ error: "creatorId required" }, { status: 400 });
  }

  if (!mediaIgId) {
    // Trigger the cron batch — forward internally with CRON_SECRET auth
    const cronSecret = process.env.CRON_SECRET;
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    const cronRes = await fetch(`${baseUrl}/api/cron/caption-analyze`, {
      headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
    }).catch(() => null);

    if (!cronRes?.ok) {
      return NextResponse.json({ status: "error", message: "Failed to trigger batch" }, { status: 502 });
    }

    const result = await cronRes.json().catch(() => ({}));
    return NextResponse.json({ status: "triggered", ...result });
  }

  const [snapshot] = await db
    .select({ caption: mediaSnapshots.caption })
    .from(mediaSnapshots)
    .where(
      and(
        eq(mediaSnapshots.mediaIgId, mediaIgId),
        eq(mediaSnapshots.creatorId, creatorId)
      )
    )
    .limit(1);

  if (!snapshot?.caption) {
    return NextResponse.json({ error: "Post not found or no caption" }, { status: 404 });
  }

  const hash = captionHash(snapshot.caption);

  if (!forceRefresh) {
    const [existing] = await db
      .select()
      .from(captionAnalysis)
      .where(
        and(
          eq(captionAnalysis.mediaIgId, mediaIgId),
          eq(captionAnalysis.creatorId, creatorId)
        )
      )
      .limit(1);

    if (existing && existing.captionHash === hash) {
      return NextResponse.json({ cached: true, analysis: existing });
    }
  }

  const prompt = `Analyze this Instagram caption for SEO and engagement. Return JSON with:
seo_score(0-100), seo_breakdown(object), hook_text(first 125 chars), hook_quality_label(strong|moderate|weak),
hashtag_quality(optimal|over_limit|none), cta_type(dm|link_bio|none), intent, tone, hook_type,
key_topics(array), product_category, has_urgency(bool), virality_signals(array), recommendations(array).

Caption: ${snapshot.caption}

Return ONLY valid JSON.`;

  const agentKey = process.env.AGENT_SERVER_API_KEY;
  const res = await fetch(`${AGENT_SERVER}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(agentKey ? { Authorization: `Bearer ${agentKey}` } : {}),
    },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Agent server error" }, { status: 502 });
  }

  const _data = await res.json();
  const result = _data.text ?? _data.result ?? "";
  let analysis: Record<string, unknown>;
  try {
    const clean = result.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
    analysis = JSON.parse(clean);
  } catch {
    return NextResponse.json({ error: "Failed to parse analysis" }, { status: 500 });
  }

  const row = {
    mediaIgId, creatorId, captionHash: hash,
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
    .values(row)
    .onConflictDoUpdate({
      target: [captionAnalysis.mediaIgId, captionAnalysis.creatorId],
      set: { ...row, analyzedAt: new Date() },
    });

  return NextResponse.json({ cached: false, analysis: row });
}
