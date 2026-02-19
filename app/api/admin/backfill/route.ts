import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { platformEarnings } from "@/lib/schema";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * One-time backfill route: pulls existing Airtable data into platform_earnings.
 * Protected by CRON_SECRET.
 *
 * Expects Airtable tables with columns:
 * - Creator (text), Platform (text), Period Start (date), Period End (date),
 *   Revenue (number), Commission (number), Clicks (number), Orders (number), Status (text)
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const airtableToken = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!airtableToken || !baseId) {
    return NextResponse.json(
      { error: "AIRTABLE_TOKEN and AIRTABLE_BASE_ID required" },
      { status: 400 }
    );
  }

  const tables = ["Mavely_Earnings", "ShopMy_Earnings", "LTK_Earnings", "Amazon_Earnings"];
  const platformMap: Record<string, string> = {
    Mavely_Earnings: "mavely",
    ShopMy_Earnings: "shopmy",
    LTK_Earnings: "ltk",
    Amazon_Earnings: "amazon",
  };

  const results: { table: string; imported: number; errors: number }[] = [];

  for (const tableName of tables) {
    let imported = 0;
    let errors = 0;
    let offset: string | undefined;

    do {
      try {
        const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
        if (offset) url.searchParams.set("offset", offset);
        url.searchParams.set("pageSize", "100");

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${airtableToken}` },
        });

        if (!res.ok) {
          errors++;
          break;
        }

        const data = await res.json();
        offset = data.offset;

        for (const record of data.records || []) {
          const f = record.fields;
          try {
            await db
              .insert(platformEarnings)
              .values({
                creatorId: f.Creator || f.creator_id || "unknown",
                platform: platformMap[tableName] as any,
                periodStart: f["Period Start"] || f.period_start || new Date().toISOString().split("T")[0],
                periodEnd: f["Period End"] || f.period_end || new Date().toISOString().split("T")[0],
                revenue: String(f.Revenue || f.revenue || 0),
                commission: String(f.Commission || f.commission || 0),
                clicks: f.Clicks || f.clicks || 0,
                orders: f.Orders || f.orders || 0,
                status: (f.Status || f.status || "open").toLowerCase() as any,
                rawPayload: JSON.stringify(f),
              })
              .onConflictDoNothing();
            imported++;
          } catch {
            errors++;
          }
        }
      } catch {
        errors++;
        break;
      }
    } while (offset);

    results.push({ table: tableName, imported, errors });
  }

  return NextResponse.json({ backfill: "complete", results });
}
