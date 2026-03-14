import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { formatCurrency } from "@/lib/utils";
import {
  DollarSign,
  MousePointerClick,
  ShoppingCart,
  TrendingUp,
  ArrowLeft,
  ExternalLink,
  Heart,
  MessageCircle,
  Eye,
  Calendar,
} from "lucide-react";
import Link from "next/link";
import AmazonEarningsChart from "@/components/earnings/AmazonEarningsChart";
import AmazonDailyChart from "@/components/earnings/AmazonDailyChart";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ startDate?: string; endDate?: string }>;
}

export default async function AmazonEarningsPage({ searchParams }: Props) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const params = await searchParams;

  // Default: last 90 days
  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const defaultStart = new Date(today.getTime() - 89 * 86400000)
    .toISOString()
    .slice(0, 10);

  const startDate = params.startDate ?? defaultStart;
  const endDate = params.endDate ?? defaultEnd;

  // Human-readable range label
  const rangeLabel =
    params.startDate
      ? `${new Date(startDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${new Date(endDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
      : "Last 90 Days";

  // ── Monthly history (all time — for table + monthly chart) ─────────
  const monthlyHistory = await db.execute(sql`
    SELECT
      period_start,
      period_end,
      CAST(revenue AS FLOAT) AS revenue,
      CAST(commission AS FLOAT) AS commission,
      clicks,
      orders,
      synced_at
    FROM platform_earnings
    WHERE platform = 'amazon'
      AND creator_id = 'nicki_entenmann'
      AND period_end = (DATE_TRUNC('month', period_start::date) + INTERVAL '1 month - 1 day')::date
    ORDER BY period_start ASC
  `);

  const months = (monthlyHistory as any[]).map((r) => ({
    periodStart: String(r.period_start),
    label: new Date(String(r.period_start) + "T00:00:00").toLocaleDateString(
      "en-US",
      { month: "short", year: "2-digit" }
    ),
    revenue: Number(r.revenue),
    commission: Number(r.commission),
    clicks: Number(r.clicks),
    orders: Number(r.orders),
  }));

  // ── Daily earnings filtered by date range ─────────────────────────
  let dailyData: { date: string; Commission: number; Revenue: number; Orders: number }[] = [];
  let dailyRawRows: any[] = [];
  try {
    const dailyRaw = await db.execute(sql`
      SELECT
        day,
        clicks,
        ordered_items,
        shipped_items,
        CAST(revenue AS FLOAT) AS revenue,
        CAST(commission AS FLOAT) AS commission
      FROM amazon_daily_earnings
      WHERE creator_id = 'nicki_entenmann'
        AND day >= ${startDate}::date
        AND day <= ${endDate}::date
      ORDER BY day ASC
    `);
    dailyRawRows = dailyRaw as any[];
    dailyData = dailyRawRows.map((r) => ({
      date: new Date(String(r.day) + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      Commission: Number(r.commission),
      Revenue: Number(r.revenue),
      Orders: Number(r.ordered_items),
    }));
  } catch {
    // Table may not exist yet
  }

  // ── KPIs from selected date range ────────────────────────────────
  const rangeCommission = dailyRawRows.reduce((s, r) => s + Number(r.commission), 0);
  const rangeRevenue = dailyRawRows.reduce((s, r) => s + Number(r.revenue), 0);
  const rangeOrders = dailyRawRows.reduce((s, r) => s + Number(r.ordered_items), 0);
  const rangeClicks = dailyRawRows.reduce((s, r) => s + Number(r.clicks), 0);

  // Fall back to monthly aggregation if no daily data
  const filteredMonths = months.filter(
    (m) => m.periodStart >= startDate.slice(0, 7) + "-01" && m.periodStart <= endDate
  );
  const monthlyCommission = filteredMonths.reduce((s, m) => s + m.commission, 0);
  const monthlyRevenue = filteredMonths.reduce((s, m) => s + m.revenue, 0);
  const monthlyOrders = filteredMonths.reduce((s, m) => s + m.orders, 0);
  const monthlyClicks = filteredMonths.reduce((s, m) => s + m.clicks, 0);

  const kpiCommission = dailyRawRows.length > 0 ? rangeCommission : monthlyCommission;
  const kpiRevenue = dailyRawRows.length > 0 ? rangeRevenue : monthlyRevenue;
  const kpiOrders = dailyRawRows.length > 0 ? rangeOrders : monthlyOrders;
  const kpiClicks = dailyRawRows.length > 0 ? rangeClicks : monthlyClicks;

  const commissionRate = kpiRevenue > 0 ? ((kpiCommission / kpiRevenue) * 100).toFixed(1) : "—";
  const cvr = kpiClicks > 0 ? ((kpiOrders / kpiClicks) * 100).toFixed(1) + "%" : "—";

  const bestMonth = months.reduce(
    (best, m) => (m.commission > (best?.commission ?? 0) ? m : best),
    months[0]
  );

  // ── Top products for selected date range ─────────────────────────
  let topProducts: {
    asin: string;
    title: string;
    ordered_items: number;
    revenue: number;
    commission: number;
  }[] = [];
  try {
    const productsRaw = await db.execute(sql`
      SELECT
        asin,
        MAX(title) AS title,
        SUM(ordered_items) AS ordered_items,
        CAST(SUM(revenue) AS FLOAT) AS revenue,
        CAST(SUM(commission) AS FLOAT) AS commission
      FROM amazon_orders
      WHERE creator_id = 'nicki_entenmann'
        AND period_start >= ${startDate}::date
        AND period_end <= ${endDate}::date
      GROUP BY asin
      ORDER BY SUM(commission) DESC
      LIMIT 25
    `);
    topProducts = (productsRaw as any[]).map((r) => ({
      asin: String(r.asin),
      title: r.title ? String(r.title) : "",
      ordered_items: Number(r.ordered_items),
      revenue: Number(r.revenue),
      commission: Number(r.commission),
    }));
  } catch {
    // Table may not exist yet
  }

  // ── Instagram posts mentioning Amazon ────────────────────────────
  const amazonPostsRaw = await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (media_ig_id)
        media_ig_id, media_type, posted_at,
        COALESCE(thumbnail_url, media_url) AS image_url,
        permalink, caption, reach, like_count, comments_count
      FROM media_snapshots
      WHERE creator_id = 'nicki_entenmann'
        AND caption ILIKE '%amazon%'
        AND posted_at IS NOT NULL
        AND posted_at >= ${startDate}::timestamptz
        AND posted_at <= (${endDate}::date + INTERVAL '1 day')::timestamptz
      ORDER BY media_ig_id, captured_at DESC
    ) deduped
    ORDER BY posted_at DESC
    LIMIT 50
  `);

  const amazonPosts = (amazonPostsRaw as any[]).map((r) => ({
    id: String(r.media_ig_id),
    mediaType: String(r.media_type ?? ""),
    postedAt: r.posted_at
      ? new Date(String(r.posted_at)).toLocaleDateString("en-US", {
          month: "short", day: "numeric", year: "numeric",
        })
      : null,
    imageUrl: r.image_url ? String(r.image_url) : null,
    permalink: r.permalink ? String(r.permalink) : null,
    caption: r.caption ? String(r.caption).slice(0, 180) : "",
    reach: r.reach ? Number(r.reach) : null,
    likes: r.like_count ? Number(r.like_count) : null,
    comments: r.comments_count ? Number(r.comments_count) : null,
  }));

  const monthlyChartData = months.map((m) => ({
    date: m.label,
    Commission: m.commission,
    Revenue: m.revenue,
  }));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/earnings"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <span className="text-amber-400 font-bold text-sm">A</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Amazon Associates</h1>
              <p className="text-sm text-muted-foreground">
                Nicki Entenmann ·{" "}
                <span className="font-mono text-amber-400/80">nickientenman-20</span>
              </p>
            </div>
          </div>
        </div>
        {/* Date range badge */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5">
          <Calendar className="h-3 w-3" />
          <span>{rangeLabel}</span>
        </div>
      </div>

      {/* KPI row — scoped to selected date range */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="h-3.5 w-3.5 text-amber-400" />
            <p className="text-xs text-muted-foreground">Commission</p>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatCurrency(kpiCommission)}</p>
          <p className="text-xs text-muted-foreground mt-1">{commissionRate}% of revenue</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Revenue</p>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatCurrency(kpiRevenue)}</p>
          <p className="text-xs text-muted-foreground mt-1">gross sales through tag</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Orders</p>
          </div>
          <p className="text-2xl font-bold text-foreground">{kpiOrders.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">{cvr} CVR</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <MousePointerClick className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Clicks</p>
          </div>
          <p className="text-2xl font-bold text-foreground">{kpiClicks.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {bestMonth ? `best: ${bestMonth.label} ${formatCurrency(bestMonth.commission)}` : "all time"}
          </p>
        </div>
      </div>

      {/* Daily chart — date-range aware */}
      {dailyData.length > 0 ? (
        <AmazonDailyChart
          data={dailyData}
          title={`Daily Earnings — ${rangeLabel}`}
        />
      ) : (
        <AmazonEarningsChart data={monthlyChartData} />
      )}

      {/* Daily breakdown table */}
      {dailyRawRows.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Day-by-Day Breakdown</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{dailyRawRows.length} days</p>
            </div>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-gray-800 text-left">
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">Revenue</th>
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">Commission</th>
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">Orders</th>
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">Clicks</th>
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">CVR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {[...dailyRawRows].reverse().map((r) => {
                  const clicks = Number(r.clicks);
                  const orders = Number(r.ordered_items);
                  const rev = Number(r.revenue);
                  const comm = Number(r.commission);
                  const cvr = clicks > 0 ? ((orders / clicks) * 100).toFixed(1) + "%" : "—";
                  const dayLabel = new Date(String(r.day) + "T00:00:00").toLocaleDateString(
                    "en-US",
                    { weekday: "short", month: "short", day: "numeric" }
                  );
                  return (
                    <tr key={String(r.day)} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-2.5 text-foreground font-medium text-xs">{dayLabel}</td>
                      <td className="px-5 py-2.5 text-right text-muted-foreground text-xs">{formatCurrency(rev)}</td>
                      <td className="px-5 py-2.5 text-right font-semibold text-foreground text-xs">{formatCurrency(comm)}</td>
                      <td className="px-5 py-2.5 text-right text-muted-foreground text-xs">{orders.toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-right text-muted-foreground text-xs">{clicks.toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-right text-muted-foreground text-xs">{cvr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Monthly breakdown table */}
      <div className="rounded-xl border border-gray-800 bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-foreground">Monthly Breakdown</h2>
          <p className="text-xs text-muted-foreground mt-0.5">All time</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left">
                <th className="px-5 py-3 text-xs font-medium text-muted-foreground">Month</th>
                <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">Revenue</th>
                <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">Commission</th>
                <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">Rate</th>
                <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">Clicks</th>
                <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">Orders</th>
                <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">CVR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {[...months].reverse().map((m) => {
                const rate =
                  m.revenue > 0
                    ? ((m.commission / m.revenue) * 100).toFixed(1) + "%"
                    : "—";
                const cvr =
                  m.clicks > 0
                    ? ((m.orders / m.clicks) * 100).toFixed(1) + "%"
                    : "—";
                const isCurrentMonth =
                  m.periodStart === new Date().toISOString().slice(0, 7) + "-01";
                const inRange =
                  m.periodStart >= startDate.slice(0, 7) + "-01" &&
                  m.periodStart <= endDate;
                return (
                  <tr
                    key={m.periodStart}
                    className={`hover:bg-muted/30 transition-colors ${
                      isCurrentMonth
                        ? "bg-amber-500/5"
                        : inRange
                        ? "bg-amber-500/3"
                        : ""
                    }`}
                  >
                    <td className="px-5 py-3 font-medium text-foreground">
                      {m.label}
                      {isCurrentMonth && (
                        <span className="ml-2 text-xs text-amber-400 font-normal">MTD</span>
                      )}
                      {inRange && !isCurrentMonth && (
                        <span className="ml-2 text-[10px] text-amber-400/50 font-normal">●</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground">{formatCurrency(m.revenue)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-foreground">{formatCurrency(m.commission)}</td>
                    <td className="px-5 py-3 text-right text-muted-foreground">{rate}</td>
                    <td className="px-5 py-3 text-right text-muted-foreground">{m.clicks.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-muted-foreground">{m.orders.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-muted-foreground">{cvr}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Products — date range aware */}
      <div className="rounded-xl border border-gray-800 bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-foreground">Top Products</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{rangeLabel} · by commission</p>
        </div>
        {topProducts.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No product data for this period.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left">
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground w-8">#</th>
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground">Product</th>
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">Ordered</th>
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">Revenue</th>
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground text-right">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {topProducts.map((p, i) => (
                  <tr key={p.asin} className="hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3 text-muted-foreground text-xs">{i + 1}</td>
                    <td className="px-5 py-3">
                      <p className="text-foreground text-sm leading-snug">
                        {p.title
                          ? p.title.length > 70
                            ? p.title.slice(0, 70) + "…"
                            : p.title
                          : "—"}
                      </p>
                      <a
                        href={`https://www.amazon.com/dp/${p.asin}?tag=nickientenman-20`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-mono text-amber-400/60 hover:text-amber-400 transition-colors mt-0.5 inline-block"
                      >
                        {p.asin} ↗
                      </a>
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground">{p.ordered_items.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-muted-foreground">{formatCurrency(p.revenue)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-foreground">{formatCurrency(p.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Amazon content posts */}
      {amazonPosts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Amazon Content</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {amazonPosts.length} posts mentioning Amazon · {rangeLabel}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {amazonPosts.map((post) => (
              <div
                key={post.id}
                className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden hover:border-amber-500/40 transition-colors group"
              >
                <div className="aspect-square bg-gray-800 relative overflow-hidden">
                  {post.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.imageUrl}
                      alt="Amazon content"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-amber-400/40 text-2xl font-bold">A</span>
                    </div>
                  )}
                  {post.mediaType === "VIDEO" && (
                    <span className="absolute top-1.5 right-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-md font-medium">
                      REEL
                    </span>
                  )}
                  {post.mediaType === "CAROUSEL_ALBUM" && (
                    <span className="absolute top-1.5 right-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-md font-medium">
                      ALBUM
                    </span>
                  )}
                  {post.permalink && (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40"
                    >
                      <ExternalLink className="h-6 w-6 text-white" />
                    </a>
                  )}
                </div>
                <div className="p-2.5 space-y-2">
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {post.caption}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
                    <span>{post.postedAt}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
                    {post.reach != null && (
                      <span className="flex items-center gap-0.5">
                        <Eye className="h-3 w-3" />
                        {post.reach >= 1000
                          ? (post.reach / 1000).toFixed(1) + "K"
                          : post.reach.toLocaleString()}
                      </span>
                    )}
                    {post.likes != null && (
                      <span className="flex items-center gap-0.5">
                        <Heart className="h-3 w-3" />
                        {post.likes >= 1000
                          ? (post.likes / 1000).toFixed(1) + "K"
                          : post.likes.toLocaleString()}
                      </span>
                    )}
                    {post.comments != null && (
                      <span className="flex items-center gap-0.5">
                        <MessageCircle className="h-3 w-3" />
                        {post.comments.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
