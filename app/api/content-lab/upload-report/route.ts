import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentReports } from "@/lib/schema";

export const dynamic = "force-dynamic";

/**
 * POST /api/content-lab/upload-report
 *
 * Accepts a completed content intelligence report from the local pipeline
 * and upserts it into content_reports.
 *
 * Auth: Bearer CRON_SECRET
 *
 * Body:
 * {
 *   creator_id:  string,
 *   season:      string,   // 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'H1' | 'H2' | 'full_year'
 *   year:        number,
 *   report_data: object    // full report JSON blob
 * }
 *
 * Returns: { success: true, report_id: number }
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { creator_id, season, year, report_data } = body;

  if (!creator_id || !season || !year || !report_data) {
    return NextResponse.json(
      { error: "creator_id, season, year, and report_data are required" },
      { status: 400 }
    );
  }

  if (typeof year !== "number" || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "year must be a valid integer" }, { status: 400 });
  }

  try {
    // Upsert: if a report already exists for this creator/season/year, replace it
    const [row] = await db
      .insert(contentReports)
      .values({
        creatorId:   creator_id,
        season:      season,
        year:        year,
        reportData:  report_data,
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [contentReports.creatorId, contentReports.season, contentReports.year],
        set: {
          reportData:  report_data,
          generatedAt: new Date(),
        },
      })
      .returning({ id: contentReports.id });

    return NextResponse.json({ success: true, report_id: row.id });
  } catch (e: any) {
    console.error("[content-lab/upload-report] DB error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
