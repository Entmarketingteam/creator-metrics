import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { creators as creatorsTable } from "@/lib/schema";
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
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import AmazonEarningsChart from "@/components/earnings/AmazonEarningsChart";
import AmazonDailyChart from "@/components/earnings/AmazonDailyChart";

export const dynamic = "force-dynamic";

export default async function AmazonEarningsPage({
  searchParams,
}: {
  searchParams: { creator?: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const creatorId = searchParams.creator ?? "nicki_entenmann";

  // ── Creator lookup ────────────────────────────────────────────────
  const creatorRows = await db
    .select()
    .from(creatorsTable)
    .where(eq(creatorsTable.id, creatorId))
    .limit(1);

  const creator = creatorRows[0];
  if (!creator) notFound();

  const displayName = creator.displayName ?? creator.username;
  const amazonTag =
    creator.amazonAssociateTag ??
    (() => {
      // Derive tag from the creator id: strip trailing _entenmann suffix if present,
      // otherwise just use the id prefix as-is and append entenman-20
      const base = creatorId.replace(/_entenmann$/, "");
      return `${base}entenman-20`;
    })();

  // ── All Amazon monthly history ────────────────────────────────────
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
      AND creator_id = ${creatorId}
      AND period_end = (DATE_TRUNC('month', period_start::date) + INTERVAL '1 month - 1 day')::date
    ORDER BY period_start ASC
  `);

  const months = (monthlyHistory as any[]).map((r) => ({
    periodStart: String(r.period_start),
    label: new Date(String(r.period_start) + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    }),
    revenue: Number(r.revenue),
    commission: Number(r.commission),
    clicks: Number(r.clicks),
    orders: Number(r.orders),
  }));

  // ── Aggregate stats ───────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const ytdMonths = months.filter((m) => m.periodStart.startsWith(String(currentYear)));
  const ytdCommission = ytdMonths.reduce((s, m) => s + m.commission, 0);
  const ytdRevenue = ytdMonths.reduce((s, m) => s + m.revenue, 0);
  const ytdOrders = ytdMonths.reduce((s, m) => s + m.orders, 0);
  const ytdClicks = ytdMonths.reduce((s, m) => s + m.clicks, 0);

  const bestMonth = months.reduce(
    (best, m) => (m.commission > (best?.commission ?? 0) ? m : best),
    months[0]
  );
  const avgCommission = months.length > 0 ? months.reduce((s, m) => s + m.commission, 0) / months.length : 0;
  const commissionRate = ytdRevenue > 0 ? ((ytdCommission / ytdRevenue) * 100).toFixed(1) : "—";
  const ytdCvr = ytdClicks > 0 ? ((ytdOrders / ytdClicks) * 100).toFixed(1) + "%" : "—";

  // ── Daily earnings (all history) ─────────────────────────────────
  let dailyData: { date: string; Commission: number; Revenue: number }[] = [];
  try {
    const dailyRaw = await db.execute(sql`
      SELECT day, CAST(revenue AS FLOAT) AS revenue, CAST(commission AS FLOAT) AS commission
      FROM amazon_daily_earnings
      WHERE creator_id = ${creatorId}
      ORDER BY day ASC
    `);
    dailyData = (dailyRaw as any[]).map((r) => ({
      date: new Date(String(r.day) + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "2-digit",
      }),
      Commission: Number(r.commission),
      Revenue: Number(r.revenue),
    }));
  } catch {
    // Table may not exist yet — fall through to monthly chart
  }

  // ── Top products (last 90 days) ───────────────────────────────────
  let topProducts: {
    asin: string;
    title: string;
    ordered_items: number;
    shipped_items: number;
    revenue: number;
    commission: number;
  }[] = [];
  try {
    const productsRaw = await db.execute(sql`
      SELECT
        asin,
        MAX(title) AS title,
        SUM(ordered_items) AS ordered_items,
        SUM(shipped_items) AS shipped_items,
        CAST(SUM(revenue) AS FLOAT) AS revenue,
        CAST(SUM(commission) AS FLOAT) AS commission
      FROM amazon_orders
      WHERE creator_id = ${creatorId}
        AND period_start >= NOW() - INTERVAL '90 days'
      GROUP BY asin
      ORDER BY SUM(commission) DESC
      LIMIT 20
    `);
    topProducts = (productsRaw as any[]).map((r) => ({
      asin: String(r.asin),
      title: r.title ? String(r.title) : "",
      ordered_items: Number(r.ordered_items),
      shipped_items: Number(r.shipped_items),
      revenue: Number(r.revenue),
      commission: Number(r.commission),
    }));
  } catch {
    // Table may not exist yet
  }

  // ── Instagram posts that mention Amazon ──────────────────────────
  const amazonPostsRaw = await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (media_ig_id)
        media_ig_id,
        media_type,
        posted_at,
        COALESCE(thumbnail_url, media_url) AS image_url,
        permalink,
        caption,
        reach,
        like_count,
        comments_count,
        total_interactions
      FROM media_snapshots
      WHERE creator_id = ${creatorId}
        AND caption ILIKE '%amazon%'
        AND posted_at IS NOT NULL
      ORDER BY media_ig_id, captured_at DESC
    ) deduped
    ORDER BY posted_at DESC
    LIMIT 50
  `);

  const amazonPosts = (amazonPostsRaw as any[]).map((r) => ({
    id: String(r.media_ig_id),
    mediaType: String(r.media_type ?? ""),
    postedAt: r.posted_at ? new Date(String(r.posted_at)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) : null,
    postedAtMonth: r.posted_at ? String(r.posted_at).slice(0, 7) : null,
    imageUrl: r.image_url ? String(r.image_url) : null,
    permalink: r.permalink ? String(r.permalink) : null,
    caption: r.caption ? String(r.caption).slice(0, 180) : "",
    reach: r.reach ? Number(r.reach) : null,
    likes: r.like_count ? Number(r.like_count) : null,
    comments: r.comments_count ? Number(r.comments_count) : null,
  }));

  // ── Chart data (monthly fallback) ────────────────────────────────
  const monthlyChartData = months.map((m) => ({
    date: m.label,
    Commission: m.commission,
    Revenue: m.revenue,
  }));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
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
              {displayName} · <span className="font-mono text-amber-400/80">{amazonTag}</span>
            </p>
          </div>
        </div>
      </div>

      {/* YTD KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="h-3.5 w-3.5 text-amber-400" />
            <p className="text-xs text-muted-foreground">{currentYear} Commission</p>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatCurrency(ytdCommission)}</p>
          <p className="text-xs text-muted-foreground mt-1">{commissionRate}% avg rate</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{currentYear} Revenue</p>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatCurrency(ytdRevenue)}</p>
          <p className="text-xs text-muted-foreground mt-1">gross sales through tag</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{currentYear} Orders</p>
          </div>
          <p className="text-2xl font-bold text-foreground">{ytdOrders.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">{ytdCvr} conversion</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Best Month</p>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {bestMonth ? formatCurrency(bestMonth.commission) : "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {bestMonth ? bestMonth.label : "no data"}
          </p>
        </div>
      </div>

      {/* Daily chart (primary) — falls back to monthly if no daily data */}
      {dailyData.length > 0 ? (
        <AmazonDailyChart data={dailyData} />
      ) : (
        <AmazonEarningsChart data={monthlyChartData} />
      )}

      {/* Monthly breakdown table */}
      <div className="rounded-xl border border-gray-800 bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-foreground">Monthly Breakdown</h2>
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
                const rate = m.revenue > 0 ? ((m.commission / m.revenue) * 100).toFixed(1) + "%" : "—";
                const cvr = m.clicks > 0 ? ((m.orders / m.clicks) * 100).toFixed(1) + "%" : "—";
                const isCurrentMonth = m.periodStart === new Date().toISOString().slice(0, 7) + "-01";
                return (
                  <tr
                    key={m.periodStart}
                    className={`hover:bg-muted/30 transition-colors ${isCurrentMonth ? "bg-amber-500/5" : ""}`}
                  >
                    <td className="px-5 py-3 font-medium text-foreground">
                      {m.label}
                      {isCurrentMonth && (
                        <span className="ml-2 text-xs text-amber-400 font-normal">MTD</span>
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

      {/* Top Products (Last 90 Days) */}
      <div className="rounded-xl border border-gray-800 bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-foreground">Top Products (Last 90 Days)</h2>
          <p className="text-xs text-muted-foreground mt-0.5">By commission earned</p>
        </div>
        {topProducts.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Sync running daily — product data will appear after next sync.
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
                        {p.title ? (p.title.length > 60 ? p.title.slice(0, 60) + "…" : p.title) : "—"}
                      </p>
                      <p className="text-[11px] font-mono text-muted-foreground/60 mt-0.5">{p.asin}</p>
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

      {/* Instagram posts that promoted Amazon */}
      {amazonPosts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Amazon Content</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {amazonPosts.length} Instagram posts mentioning Amazon
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {amazonPosts.map((post) => (
              <div
                key={post.id}
                className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden hover:border-amber-500/40 transition-colors group"
              >
                {/* Post image */}
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
                  {/* Media type badge */}
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
                  {/* External link overlay */}
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

                {/* Post meta */}
                <div className="p-2.5 space-y-2">
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {post.caption}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
                    <span>{post.postedAt}</span>
                  </div>
                  {/* Engagement metrics */}
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
