import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { CREATORS } from "@/lib/creators";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/sync-intelligence
 * Analyzes recent Amazon sync data for a creator and posts insights to Slack.
 *
 * Auth: Bearer CRON_SECRET
 * Body: { creator_id: string }
 *
 * Called automatically by tools/amazon-data-sync.py after each successful push.
 */

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function pctChange(current: number, prior: number): string {
  if (prior === 0) return current > 0 ? "+∞%" : "—";
  const pct = ((current - prior) / prior) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function trendArrow(current: number, prior: number): string {
  if (prior === 0) return "";
  return current >= prior ? "↑" : "↓";
}

function paceLabel(projectedFull: number, mtdAvgDaily: number, bestDayAmount: number): string {
  // Categorize pace vs a rough prior performance benchmark
  // Best day as ceiling, compare projected vs current MTD daily avg extrapolated
  if (projectedFull >= bestDayAmount * 15) return "🔥 strong pace";
  if (projectedFull >= bestDayAmount * 8) return "📈 above avg";
  return "📉 below avg";
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { creator_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { creator_id } = body;
  if (!creator_id) {
    return NextResponse.json({ error: "creator_id required" }, { status: 400 });
  }

  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!slackWebhookUrl) {
    return NextResponse.json({ error: "SLACK_WEBHOOK_URL not configured" }, { status: 500 });
  }

  // Resolve display name from CREATORS config
  const creatorConfig = CREATORS.find(
    (c) => c.id === creator_id || c.id.replace(/_/g, " ").toLowerCase() === creator_id.replace(/_/g, " ").toLowerCase()
  );
  const displayName = creatorConfig?.displayName ?? creator_id;

  // ── Query: last 14 days daily earnings ──────────────────────────────────────
  const dailyRows = await db.execute(sql`
    SELECT day, CAST(commission AS FLOAT) as commission, clicks, ordered_items
    FROM amazon_daily_earnings
    WHERE creator_id = ${creator_id}
      AND day >= NOW() - INTERVAL '14 days'
    ORDER BY day ASC
  `);
  const daily = Array.from(dailyRows) as {
    day: string;
    commission: number;
    clicks: number;
    ordered_items: number;
  }[];

  // ── Query: current + last month platform_earnings ────────────────────────────
  const monthlyRows = await db.execute(sql`
    SELECT period_start, CAST(commission AS FLOAT) as commission,
           CAST(revenue AS FLOAT) as revenue, clicks, orders
    FROM platform_earnings
    WHERE creator_id = ${creator_id}
      AND platform = 'amazon'
      AND period_start >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
    ORDER BY period_start ASC
  `);
  const monthly = Array.from(monthlyRows) as {
    period_start: string;
    commission: number;
    revenue: number;
    clicks: number;
    orders: number;
  }[];

  // ── Query: best day in last 30 days ──────────────────────────────────────────
  const bestDayRows = await db.execute(sql`
    SELECT day, CAST(commission AS FLOAT) as commission
    FROM amazon_daily_earnings
    WHERE creator_id = ${creator_id}
      AND day >= NOW() - INTERVAL '30 days'
    ORDER BY commission DESC
    LIMIT 1
  `);
  const bestDayRow = Array.from(bestDayRows)[0] as
    | { day: string; commission: number }
    | undefined;

  // ── Compute week-over-week ────────────────────────────────────────────────────
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

  const thisWeekRows = daily.filter((r) => r.day >= sevenDaysAgoStr && r.day <= todayStr);
  const lastWeekRows = daily.filter((r) => r.day < sevenDaysAgoStr);

  const thisWeekCommission = thisWeekRows.reduce((s, r) => s + (r.commission || 0), 0);
  const lastWeekCommission = lastWeekRows.reduce((s, r) => s + (r.commission || 0), 0);
  const thisWeekClicks = thisWeekRows.reduce((s, r) => s + (r.clicks || 0), 0);
  const lastWeekClicks = lastWeekRows.reduce((s, r) => s + (r.clicks || 0), 0);

  // ── MTD and last-month commission from platform_earnings ─────────────────────
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    .toISOString()
    .split("T")[0];

  const currentMonthRow = monthly.find((r) => r.period_start.slice(0, 7) === currentMonthStart.slice(0, 7));
  const lastMonthRow = monthly.find((r) => r.period_start.slice(0, 7) === lastMonthStart.slice(0, 7));

  const mtdCommission = currentMonthRow?.commission ?? 0;
  const lastMonthCommission = lastMonthRow?.commission ?? 0;

  // ── Projected full-month (daily avg × days in month) ─────────────────────────
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const mtdDailyAvg = dayOfMonth > 0 ? mtdCommission / dayOfMonth : 0;
  const projectedFullMonth = mtdDailyAvg * daysInMonth;

  // ── Month label ───────────────────────────────────────────────────────────────
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const lastMonthLabel = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString(
    "en-US",
    { month: "long" }
  );
  const dateLabel = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // ── Best day label ────────────────────────────────────────────────────────────
  const bestDayLabel = bestDayRow
    ? new Date(bestDayRow.day + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })
    : null;

  // ── Build Slack Block Kit payload ─────────────────────────────────────────────
  const commissionPct = pctChange(thisWeekCommission, lastWeekCommission);
  const commissionArrow = trendArrow(thisWeekCommission, lastWeekCommission);
  const clicksPct = pctChange(thisWeekClicks, lastWeekClicks);
  const clicksArrow = trendArrow(thisWeekClicks, lastWeekClicks);
  const mtdVsLastMonth = pctChange(mtdCommission, lastMonthCommission);
  const mtdArrow = trendArrow(mtdCommission, lastMonthCommission);
  const pace = paceLabel(projectedFullMonth, mtdDailyAvg, bestDayRow?.commission ?? 0);

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Amazon Sync — ${displayName}`,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `📅 ${dateLabel}`,
        },
      ],
    },
    {
      type: "divider",
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*This week vs last week*\nCommission: ${formatCurrency(thisWeekCommission)} *(${commissionPct})* ${commissionArrow}\nClicks: ${formatNumber(thisWeekClicks)} *(${clicksPct})* ${clicksArrow}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${monthLabel} MTD*\nCommission: ${formatCurrency(mtdCommission)}\nProjected month: ${formatCurrency(projectedFullMonth)} — ${pace}\nvs ${lastMonthLabel}: ${mtdVsLastMonth} ${mtdArrow}`,
      },
    },
    ...(bestDayRow
      ? [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Best day this month:* ${bestDayLabel} — ${formatCurrency(bestDayRow.commission)}`,
            },
          },
        ]
      : []),
    {
      type: "divider",
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<https://creator-metrics.vercel.app|View full dashboard> · Amazon Associates`,
        },
      ],
    },
  ];

  // ── POST to Slack ─────────────────────────────────────────────────────────────
  const slackRes = await fetch(slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  if (!slackRes.ok) {
    const errText = await slackRes.text();
    return NextResponse.json(
      { error: "Slack post failed", detail: errText },
      { status: 502 }
    );
  }

  const summary = `${displayName}: WoW commission ${commissionPct}, MTD ${formatCurrency(mtdCommission)}, projected ${formatCurrency(projectedFullMonth)}`;

  return NextResponse.json({
    ok: true,
    creator_id,
    summary,
    metrics: {
      thisWeekCommission,
      lastWeekCommission,
      thisWeekClicks,
      lastWeekClicks,
      mtdCommission,
      lastMonthCommission,
      projectedFullMonth,
      bestDay: bestDayRow ?? null,
    },
  });
}
