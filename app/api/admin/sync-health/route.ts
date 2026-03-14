import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { creators } from "@/lib/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const STALE_DAYS = 2;

function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Parallel queries
  const [allCreators, platformRows, amazonDailyRows] = await Promise.all([
    db.select({ id: creators.id, displayName: creators.displayName }).from(creators),
    db.execute(sql`
      SELECT
        creator_id,
        platform,
        MAX(synced_at)   AS last_sync,
        COUNT(*)         AS row_count,
        COUNT(DISTINCT DATE_TRUNC('month', period_start::timestamp)) AS months_count,
        MAX(period_end)  AS latest_period
      FROM platform_earnings
      GROUP BY creator_id, platform
      ORDER BY creator_id, platform
    `),
    db.execute(sql`
      SELECT
        creator_id,
        COUNT(*)         AS daily_count,
        MAX(synced_at)   AS last_sync,
        MAX(day)         AS latest_day
      FROM amazon_daily_earnings
      GROUP BY creator_id
    `),
  ]);

  // Index platform rows
  type PlatformRow = {
    creator_id: string;
    platform: string;
    last_sync: Date | null;
    row_count: string | number;
    months_count: string | number;
    latest_period: string | null;
  };

  const platformMap = new Map<string, PlatformRow>();
  for (const row of platformRows as unknown as PlatformRow[]) {
    platformMap.set(`${row.creator_id}::${row.platform}`, row);
  }

  type AmazonDailyRow = {
    creator_id: string;
    daily_count: string | number;
    last_sync: Date | null;
    latest_day: string | null;
  };

  const amazonDailyMap = new Map<string, AmazonDailyRow>();
  for (const row of amazonDailyRows as unknown as AmazonDailyRow[]) {
    amazonDailyMap.set(row.creator_id, row);
  }

  const PLATFORMS = ["amazon", "ltk", "shopmy", "mavely"] as const;

  type PlatformHealth = {
    last_sync: string | null;
    status: "ok" | "stale" | "never_synced";
    months_count: number;
    daily_count?: number;
    gap_days: number | null;
  };

  type Alert = {
    creator_id: string;
    platform: string;
    severity: "warning" | "error";
    message: string;
  };

  const alerts: Alert[] = [];

  const creatorResults = allCreators.map((creator) => {
    const platforms: Record<string, PlatformHealth> = {};

    for (const platform of PLATFORMS) {
      const key = `${creator.id}::${platform}`;
      const row = platformMap.get(key);

      let lastSync: string | null = null;
      let status: "ok" | "stale" | "never_synced" = "never_synced";
      let monthsCount = 0;
      let gapDays: number | null = null;
      let dailyCount: number | undefined = undefined;

      if (row && row.last_sync) {
        const syncDate = new Date(row.last_sync);
        lastSync = syncDate.toISOString();
        gapDays = daysBetween(syncDate, now);
        status = gapDays > STALE_DAYS ? "stale" : "ok";
        monthsCount = Number(row.months_count) || 0;
      }

      if (platform === "amazon") {
        const daily = amazonDailyMap.get(creator.id);
        if (daily) {
          dailyCount = Number(daily.daily_count) || 0;
          // Use the most recent of the two syncs for amazon status
          if (daily.last_sync) {
            const dailySyncDate = new Date(daily.last_sync);
            const dailyGap = daysBetween(dailySyncDate, now);
            if (status === "never_synced") {
              lastSync = dailySyncDate.toISOString();
              gapDays = dailyGap;
              status = dailyGap > STALE_DAYS ? "stale" : "ok";
            } else {
              // Use whichever sync is more recent
              if (dailySyncDate > new Date(lastSync!)) {
                gapDays = dailyGap;
                status = dailyGap > STALE_DAYS ? "stale" : "ok";
              }
            }
          }
        }
      }

      const health: PlatformHealth = {
        last_sync: lastSync,
        status,
        months_count: monthsCount,
        gap_days: gapDays,
      };

      if (platform === "amazon" && dailyCount !== undefined) {
        health.daily_count = dailyCount;
      }

      platforms[platform] = health;

      // Generate alerts
      if (status === "never_synced") {
        alerts.push({
          creator_id: creator.id,
          platform,
          severity: "warning",
          message: "Never synced",
        });
      } else if (status === "stale") {
        alerts.push({
          creator_id: creator.id,
          platform,
          severity: "warning",
          message: `Last sync ${gapDays} day${gapDays === 1 ? "" : "s"} ago`,
        });
      }
    }

    return {
      id: creator.id,
      display_name: creator.displayName || creator.id,
      platforms,
    };
  });

  return NextResponse.json({
    creators: creatorResults,
    alerts,
    generated_at: now.toISOString(),
  });
}
