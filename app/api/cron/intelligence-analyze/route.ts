import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { creatorIntelligence, creators } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const AGENT_SERVER = "https://ent-agent-server-production.up.railway.app";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().split("T")[0];

  // Get all owned creators
  const owned = await db
    .select({ id: creators.id, username: creators.username })
    .from(creators)
    .where(eq(creators.isOwned, true));

  if (!owned.length) {
    return NextResponse.json({ message: "No owned creators", processed: 0 });
  }

  let processed = 0;
  let errors = 0;
  const results: Record<string, string> = {};

  for (const creator of owned) {
    try {
      await analyzeCreator(creator.id, today);
      processed++;
      results[creator.id] = "ok";
    } catch (e: any) {
      errors++;
      results[creator.id] = e.message;
      console.error(`[intelligence-analyze] ${creator.id}:`, e.message);
    }
  }

  return NextResponse.json({ processed, errors, today, results });
}

async function analyzeCreator(creatorId: string, today: string) {
  // Check if we already have analysis for today
  const [existing] = await db
    .select({ id: creatorIntelligence.id })
    .from(creatorIntelligence)
    .where(
      eq(creatorIntelligence.creatorId, creatorId) &&
      sql`${creatorIntelligence.generatedAt} = ${today}::date`
    )
    .limit(1);

  if (existing) return; // Already done today

  // Pull 90-day post performance summary
  const [stats] = await db.execute(sql`
    SELECT
      COUNT(*) AS total_posts,
      ROUND(AVG(reach))  AS avg_reach,
      ROUND(AVG(saves))  AS avg_saves,
      ROUND(AVG(likes))  AS avg_likes,
      ROUND(AVG(shares)) AS avg_shares
    FROM creator_posts
    WHERE creator_id = ${creatorId}
      AND posted_at >= NOW() - INTERVAL '90 days'
  `) as any;

  // Recent vs older period comparison (engagement trend)
  const recentRows = await db.execute(sql`
    SELECT ROUND(AVG(reach)) AS avg_reach, ROUND(AVG(saves)) AS avg_saves
    FROM creator_posts
    WHERE creator_id = ${creatorId}
      AND posted_at >= NOW() - INTERVAL '30 days'
  `) as any;

  const olderRows = await db.execute(sql`
    SELECT ROUND(AVG(reach)) AS avg_reach, ROUND(AVG(saves)) AS avg_saves
    FROM creator_posts
    WHERE creator_id = ${creatorId}
      AND posted_at >= NOW() - INTERVAL '60 days'
      AND posted_at < NOW() - INTERVAL '30 days'
  `) as any;

  // By content type
  const byTypeRows = await db.execute(sql`
    SELECT
      media_product_type AS type,
      COUNT(*) AS post_count,
      ROUND(AVG(reach)) AS avg_reach,
      ROUND(AVG(saves)) AS avg_saves
    FROM creator_posts
    WHERE creator_id = ${creatorId}
      AND posted_at >= NOW() - INTERVAL '90 days'
      AND media_product_type IS NOT NULL
    GROUP BY media_product_type
    ORDER BY avg_reach DESC NULLS LAST
  `) as any;

  // Best posting days (by day of week)
  const dayRows = await db.execute(sql`
    SELECT
      TO_CHAR(posted_at, 'Day') AS day_name,
      ROUND(AVG(reach)) AS avg_reach
    FROM creator_posts
    WHERE creator_id = ${creatorId}
      AND posted_at >= NOW() - INTERVAL '90 days'
    GROUP BY day_name
    ORDER BY avg_reach DESC NULLS LAST
    LIMIT 3
  `) as any;

  // Top captions (for theme analysis)
  const topPostRows = await db.execute(sql`
    SELECT caption, saves, likes, reach, post_id, post_url
    FROM creator_posts
    WHERE creator_id = ${creatorId}
      AND posted_at >= NOW() - INTERVAL '90 days'
      AND caption IS NOT NULL AND caption != ''
      AND saves IS NOT NULL
    ORDER BY saves DESC NULLS LAST
    LIMIT 20
  `) as any;

  // Hidden gems: high-saves posts with below-average reach
  const hiddenGemRows = await db.execute(sql`
    SELECT post_id, post_url, caption, saves, likes, reach
    FROM creator_posts
    WHERE creator_id = ${creatorId}
      AND posted_at >= NOW() - INTERVAL '90 days'
      AND saves > (
        SELECT PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY saves)
        FROM creator_posts
        WHERE creator_id = ${creatorId}
          AND posted_at >= NOW() - INTERVAL '90 days'
          AND saves IS NOT NULL
      )
      AND reach < (
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY reach)
        FROM creator_posts
        WHERE creator_id = ${creatorId}
          AND posted_at >= NOW() - INTERVAL '90 days'
          AND reach IS NOT NULL
      )
    ORDER BY saves DESC
    LIMIT 5
  `) as any;

  const topPosts = (Array.from(topPostRows) as any[]).slice(0, 20);
  const hiddenGems = (Array.from(hiddenGemRows) as any[]).slice(0, 5);
  const recent = (Array.from(recentRows) as any[])[0];
  const older = (Array.from(olderRows) as any[])[0];
  const byType = Array.from(byTypeRows) as any[];
  const days = Array.from(dayRows) as any[];
  const s = (Array.from(stats as any) as any[])[0];

  // Build prompt
  const captionSummary = topPosts
    .map((p: any, i: number) =>
      `${i + 1}. Saves:${p.saves} Reach:${p.reach} "${(p.caption ?? "").slice(0, 120)}"`
    )
    .join("\n");

  const prompt = `You are analyzing Instagram performance data for a creator. Based on the data below, generate a JSON analysis.

Creator: ${creatorId}
Period: Last 90 days
Total posts: ${s?.total_posts ?? 0}
Avg reach: ${s?.avg_reach ?? 0}  Avg saves: ${s?.avg_saves ?? 0}  Avg likes: ${s?.avg_likes ?? 0}

Recent 30-day avg reach: ${recent?.avg_reach ?? 0} vs prior 30-day: ${older?.avg_reach ?? 0}

By content type:
${byType.map((r: any) => `- ${r.type}: ${r.post_count} posts, avg reach ${r.avg_reach}, avg saves ${r.avg_saves}`).join("\n")}

Best posting days by avg reach:
${days.map((d: any) => `- ${d.day_name?.trim()}: avg reach ${d.avg_reach}`).join("\n")}

Top 20 posts by saves (caption preview):
${captionSummary}

Return a JSON object with EXACTLY these fields (no markdown):
{
  "engagementTrend": "<improving|declining|stable>",
  "trendNote": "<1-2 sentence explanation of the trend>",
  "bestPostingDays": ["<day1>", "<day2>", "<day3>"],
  "byContentType": [{"type": "<REELS|FEED|etc>", "avgReach": <number>}],
  "themes": [
    {"name": "<theme name>", "avgReach": <number>, "avgSaves": <number>, "postCount": <number>},
    ...
  ],
  "hiddenGems": [
    {"postId": "<id>", "postUrl": "<url>", "caption": "<first 100 chars>", "saves": <number>, "likes": <number>}
  ],
  "keyInsights": ["<insight 1>", "<insight 2>", "<insight 3>"]
}

Identify 3-5 content themes from the top posts. Return ONLY valid JSON.`;

  const res = await fetch(`${AGENT_SERVER}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) throw new Error(`Agent server returned ${res.status}`);

  const data = await res.json();
  const raw = (data.text ?? data.result ?? "").trim();
  const clean = raw.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}") + 1;
  if (start === -1 || end === 0) throw new Error("No JSON in agent response");

  const analysis = JSON.parse(clean.slice(start, end));

  // Merge hidden gems from DB with agent analysis
  if (hiddenGems.length > 0 && (!analysis.hiddenGems || analysis.hiddenGems.length === 0)) {
    analysis.hiddenGems = hiddenGems.map((g: any) => ({
      postId: g.post_id,
      postUrl: g.post_url,
      caption: (g.caption ?? "").slice(0, 100),
      saves: g.saves ?? 0,
      likes: g.likes ?? 0,
    }));
  }

  await db
    .insert(creatorIntelligence)
    .values({
      creatorId,
      generatedAt: today,
      analysis,
    })
    .onConflictDoUpdate({
      target: [creatorIntelligence.creatorId, creatorIntelligence.generatedAt],
      set: { analysis },
    });
}
