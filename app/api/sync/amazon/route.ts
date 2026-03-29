import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET /api/sync/amazon?creator=nicki
 *
 * Triggers an Amazon Associates data sync for one creator (or all if omitted).
 *
 * Auth: Bearer CRON_SECRET
 *
 * How it works:
 *   Amazon's WAF blocks Vercel/Railway datacenter IPs (403). This route cannot
 *   call Amazon directly. Instead, it delegates to the local Mac agent server
 *   (agent.entagency.co), which runs amazon-data-sync.py on the Mac and returns
 *   the result. If the agent server is unreachable, the route returns the last
 *   known sync status from the DB.
 *
 * Query params:
 *   creator  — one of: nicki, ann, ellen, emily, all (default: all)
 *   months   — months of history to sync (default: 3)
 *   days     — days of daily data to sync (default: 90)
 *
 * Response:
 *   { triggered: true, creator, mode: "agent", result: {...} }
 *   { triggered: false, creator, mode: "status_only", reason: "...", last_syncs: [...] }
 */

const VALID_CREATORS = ["nicki", "ann", "ellen", "emily", "all"] as const;
type CreatorArg = (typeof VALID_CREATORS)[number];

const CREATOR_DB_IDS: Record<string, string> = {
  nicki: "nicki_entenmann",
  ann: "annbschulte",
  ellen: "ellenludwigfitness",
  emily: "livefitwithem",
};

async function getLastSyncStatus(creatorDbId: string) {
  const rows = await db.execute(sql`
    SELECT
      'monthly' AS source,
      MAX(synced_at) AS last_sync,
      COUNT(*) AS row_count
    FROM platform_earnings
    WHERE creator_id = ${creatorDbId} AND platform = 'amazon'
    UNION ALL
    SELECT
      'daily' AS source,
      MAX(synced_at) AS last_sync,
      COUNT(*) AS row_count
    FROM amazon_daily_earnings
    WHERE creator_id = ${creatorDbId}
  `);
  return Array.from(rows) as { source: string; last_sync: Date | null; row_count: string }[];
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawCreator = (searchParams.get("creator") ?? "all").toLowerCase();
  const months = Math.min(parseInt(searchParams.get("months") ?? "3", 10), 12);
  const days = Math.min(parseInt(searchParams.get("days") ?? "90", 10), 365);

  if (!VALID_CREATORS.includes(rawCreator as CreatorArg)) {
    return NextResponse.json(
      { error: `Invalid creator. Must be one of: ${VALID_CREATORS.join(", ")}` },
      { status: 400 }
    );
  }

  const creator = rawCreator as CreatorArg;
  const creatorsToSync = creator === "all" ? ["nicki", "ann", "ellen", "emily"] : [creator];

  // ── Try agent server (local Mac) ──────────────────────────────────────────
  const agentUrl = process.env.AGENT_SERVER_URL ?? "https://agent.entagency.co";
  const agentSecret = process.env.CRON_SECRET ?? "";

  // Build the prompt that agent server will execute via claude CLI
  const syncPrompt = [
    `Run the Amazon Associates data sync for creator(s): ${creatorsToSync.join(", ")}.`,
    `Command: doppler run --project ent-agency-automation --config dev -- python3 /Users/ethanatchley/creator-metrics/tools/amazon-data-sync.py --creator ${creator} --months ${months} --days ${days}`,
    `Return a JSON summary with keys: creator, status, monthly_synced, daily_synced, error (if any).`,
    `Run the command exactly as shown and capture stdout/stderr.`,
  ].join("\n");

  let agentResult: any = null;
  let agentError: string | null = null;

  try {
    const agentRes = await fetch(`${agentUrl}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentSecret}`,
      },
      body: JSON.stringify({ prompt: syncPrompt, timeout: 55000 }),
      signal: AbortSignal.timeout(58000),
    });

    if (agentRes.ok) {
      const agentData = await agentRes.json() as { result?: string; error?: string };
      if (agentData.result) {
        // Try to parse JSON from result, fall back to raw string
        try {
          const jsonMatch = agentData.result.match(/\{[\s\S]*\}/);
          agentResult = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: agentData.result };
        } catch {
          agentResult = { raw: agentData.result };
        }
      } else {
        agentError = agentData.error ?? "Agent returned no result";
      }
    } else {
      const body = await agentRes.text().catch(() => "");
      agentError = `Agent server returned ${agentRes.status}: ${body.slice(0, 200)}`;
    }
  } catch (e: unknown) {
    agentError = e instanceof Error ? e.message : String(e);
  }

  // ── If agent worked, return success ──────────────────────────────────────
  if (agentResult) {
    return NextResponse.json({
      triggered: true,
      creator,
      months,
      days,
      mode: "agent",
      result: agentResult,
      synced_at: new Date().toISOString(),
    });
  }

  // ── Agent unavailable — return DB status ─────────────────────────────────
  const statusByCreator: Record<string, any> = {};

  for (const c of creatorsToSync) {
    const dbId = CREATOR_DB_IDS[c];
    if (!dbId) continue;
    try {
      const syncRows = await getLastSyncStatus(dbId);
      statusByCreator[c] = {
        creator_db_id: dbId,
        sync_status: syncRows.reduce(
          (acc, r) => {
            acc[r.source] = {
              last_sync: r.last_sync?.toISOString() ?? null,
              row_count: Number(r.row_count),
            };
            return acc;
          },
          {} as Record<string, any>
        ),
      };
    } catch (dbErr: unknown) {
      statusByCreator[c] = { error: dbErr instanceof Error ? dbErr.message : String(dbErr) };
    }
  }

  return NextResponse.json({
    triggered: false,
    creator,
    mode: "status_only",
    reason: agentError ?? "Agent server unreachable",
    manual_sync_command: `python3 ~/creator-metrics/tools/amazon-data-sync.py --creator ${creator} --months ${months} --days ${days}`,
    last_syncs: statusByCreator,
  });
}
