import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { platformEarnings, creators } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";
// Airtable base appQnKyfyRyhHX44h — Claude Created LTK and AMAZON EARNINGS
// Table tblZkX1SuNlo2DNOb — Mavely
const MAVELY_TABLE_ID = "tblZkX1SuNlo2DNOb";

interface MavelyRecord {
  id: string;
  fields: {
    "Creator ID": string;
    "Source Platform": string;
    "Period Start": string;
    "Period End": string;
    "Normalized Earnings": number;
    "Recorded At": string;
    "Raw Payload": string;
    Currency: string;
    "Raw Type": string;
  };
}

async function fetchMavelyRecords(
  airtableToken: string,
  baseId: string,
  offset?: string
): Promise<{ records: MavelyRecord[]; offset?: string }> {
  const params = new URLSearchParams({ pageSize: "100" });
  params.set("sort[0][field]", "Recorded At");
  params.set("sort[0][direction]", "desc");
  if (offset) params.set("offset", offset);

  const res = await fetch(
    `${AIRTABLE_API_BASE}/${baseId}/${MAVELY_TABLE_ID}?${params}`,
    {
      headers: { Authorization: `Bearer ${airtableToken}` },
      next: { revalidate: 0 },
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable Mavely fetch failed ${res.status}: ${err}`);
  }

  return res.json();
}

/**
 * Mavely sync cron — pulls earnings records from Airtable and upserts
 * into platformEarnings table in Supabase.
 * Vercel cron: 7:30am UTC daily.
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
      { error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID env vars" },
      { status: 500 }
    );
  }

  try {
    // Fetch all creators with Mavely IDs so we can map Creator ID → internal creator
    const allCreators = await db
      .select({ id: creators.id, mavelyCreatorId: creators.mavelyCreatorId })
      .from(creators)
      .where(eq(creators.isOwned, true));

    const creatorByMavelyId = new Map(
      allCreators
        .filter((c) => c.mavelyCreatorId)
        .map((c) => [c.mavelyCreatorId!, c.id])
    );

    // If no Mavely IDs mapped, fall back to first owned creator (single-creator setup)
    const fallbackCreatorId = allCreators.find((c) => c.id)?.id ?? null;

    let inserted = 0;
    let skipped = 0;
    let offset: string | undefined;

    // Only pull last 90 days to keep the sync window manageable
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    do {
      const page = await fetchMavelyRecords(airtableToken, baseId, offset);
      offset = page.offset;

      for (const record of page.records) {
        const f = record.fields;
        const periodStart = f["Period Start"];
        const periodEnd = f["Period End"];
        const earnings = f["Normalized Earnings"];

        if (!periodStart || !periodEnd || earnings == null) {
          skipped++;
          continue;
        }

        // Skip records older than cutoff
        if (new Date(periodStart) < cutoff) {
          skipped++;
          continue;
        }

        // Map Mavely Creator ID → internal creator ID
        const mavelyId = f["Creator ID"];
        const creatorId =
          (mavelyId ? creatorByMavelyId.get(mavelyId) : undefined) ??
          fallbackCreatorId;

        if (!creatorId) {
          skipped++;
          continue;
        }

        await db
          .insert(platformEarnings)
          .values({
            creatorId,
            platform: "mavely",
            periodStart,
            periodEnd,
            revenue: String(earnings),
            commission: String(earnings),
            rawPayload: f["Raw Payload"] ?? null,
            syncedAt: new Date(),
          })
          .onConflictDoNothing();

        inserted++;
      }
    } while (offset);

    return NextResponse.json({
      synced: new Date().toISOString(),
      inserted,
      skipped,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
