import { eq, desc, sql, and, between, ilike, count, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  platformEarnings,
  sales,
  products,
  creators,
  platformConnections,
} from "@/lib/schema";

// ── Types ────────────────────────────────────────────────────────────

interface EarningsSummaryRow {
  platform: string;
  totalRevenue: number;
  totalCommission: number;
  totalClicks: number;
  totalOrders: number;
}

interface EarningsHistoryRow {
  periodStart: string;
  revenue: number;
  commission: number;
  platform: string;
}

interface SalesQueryOptions {
  platform?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

interface PaginatedSales {
  data: (typeof sales.$inferSelect)[];
  total: number;
  page: number;
  totalPages: number;
}

interface PlatformBreakdown {
  platform: string;
  revenue: number;
  percentage: number;
}

interface AggregateEarnings {
  totalRevenue: number;
  totalCommission: number;
  totalClicks: number;
  totalOrders: number;
  byPlatform: EarningsSummaryRow[];
}

// ── Queries ──────────────────────────────────────────────────────────

/**
 * Get total earnings per platform for a creator within a time range.
 */
export async function getCreatorEarningsSummary(
  creatorId: string,
  days = 30
): Promise<EarningsSummaryRow[]> {
  const rows = await db
    .select({
      platform: platformEarnings.platform,
      totalRevenue: sql<number>`CAST(COALESCE(SUM(${platformEarnings.revenue}), 0) AS FLOAT)`,
      totalCommission: sql<number>`CAST(COALESCE(SUM(${platformEarnings.commission}), 0) AS FLOAT)`,
      totalClicks: sql<number>`COALESCE(SUM(${platformEarnings.clicks}), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${platformEarnings.orders}), 0)`,
    })
    .from(platformEarnings)
    .where(
      and(
        eq(platformEarnings.creatorId, creatorId),
        sql`${platformEarnings.syncedAt} >= NOW() - MAKE_INTERVAL(days => ${days})`
      )
    )
    .groupBy(platformEarnings.platform)
    .orderBy(sql`CAST(COALESCE(SUM(${platformEarnings.revenue}), 0) AS FLOAT) DESC`);

  return rows;
}

/**
 * Get time-series earnings history for charts.
 * Optionally filter by platform.
 */
export async function getCreatorEarningsHistory(
  creatorId: string,
  platform?: string,
  days = 30
): Promise<EarningsHistoryRow[]> {
  const conditions = [
    eq(platformEarnings.creatorId, creatorId),
    sql`${platformEarnings.syncedAt} >= NOW() - MAKE_INTERVAL(days => ${days})`,
  ];

  if (platform) {
    conditions.push(sql`${platformEarnings.platform} = ${platform}`);
  }

  const rows = await db
    .select({
      periodStart: platformEarnings.periodStart,
      revenue: sql<number>`CAST(${platformEarnings.revenue} AS FLOAT)`,
      commission: sql<number>`CAST(${platformEarnings.commission} AS FLOAT)`,
      platform: platformEarnings.platform,
    })
    .from(platformEarnings)
    .where(and(...conditions))
    .orderBy(platformEarnings.periodStart);

  return rows;
}

/**
 * Get paginated sales with optional filters for platform, status, and search.
 * Search matches on productName or brand (case-insensitive).
 */
export async function getCreatorSales(
  creatorId: string,
  options: SalesQueryOptions = {}
): Promise<PaginatedSales> {
  const { platform, status, search, page = 1, limit = 25 } = options;
  const offset = (page - 1) * limit;

  const conditions = [eq(sales.creatorId, creatorId)];

  if (platform) {
    conditions.push(sql`${sales.platform} = ${platform}`);
  }

  if (status) {
    conditions.push(sql`${sales.status} = ${status}`);
  }

  if (search) {
    conditions.push(
      sql`(${ilike(sales.productName, `%${search}%`)} OR ${ilike(sales.brand, `%${search}%`)})`
    );
  }

  const whereClause = and(...conditions);

  const [totalResult, data] = await Promise.all([
    db
      .select({ count: count() })
      .from(sales)
      .where(whereClause)
      .then((r) => r[0]?.count ?? 0),
    db
      .select()
      .from(sales)
      .where(whereClause)
      .orderBy(desc(sales.saleDate))
      .limit(limit)
      .offset(offset),
  ]);

  const total = Number(totalResult);

  return {
    data,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get top products by total revenue for a creator.
 */
export async function getCreatorTopProducts(
  creatorId: string,
  limit = 10
): Promise<(typeof products.$inferSelect)[]> {
  const rows = await db
    .select()
    .from(products)
    .where(eq(products.creatorId, creatorId))
    .orderBy(sql`CAST(${products.totalRevenue} AS FLOAT) DESC`)
    .limit(limit);

  return rows;
}

/**
 * Get aggregate earnings across all creators (dashboard overview).
 */
export async function getAggregateEarnings(
  days = 30
): Promise<AggregateEarnings> {
  const dateFilter = sql`${platformEarnings.syncedAt} >= NOW() - MAKE_INTERVAL(days => ${days})`;

  const [totals, byPlatform] = await Promise.all([
    db
      .select({
        totalRevenue: sql<number>`CAST(COALESCE(SUM(${platformEarnings.revenue}), 0) AS FLOAT)`,
        totalCommission: sql<number>`CAST(COALESCE(SUM(${platformEarnings.commission}), 0) AS FLOAT)`,
        totalClicks: sql<number>`COALESCE(SUM(${platformEarnings.clicks}), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${platformEarnings.orders}), 0)`,
      })
      .from(platformEarnings)
      .where(dateFilter)
      .then((r) => r[0]),
    db
      .select({
        platform: platformEarnings.platform,
        totalRevenue: sql<number>`CAST(COALESCE(SUM(${platformEarnings.revenue}), 0) AS FLOAT)`,
        totalCommission: sql<number>`CAST(COALESCE(SUM(${platformEarnings.commission}), 0) AS FLOAT)`,
        totalClicks: sql<number>`COALESCE(SUM(${platformEarnings.clicks}), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${platformEarnings.orders}), 0)`,
      })
      .from(platformEarnings)
      .where(dateFilter)
      .groupBy(platformEarnings.platform)
      .orderBy(sql`CAST(COALESCE(SUM(${platformEarnings.revenue}), 0) AS FLOAT) DESC`),
  ]);

  return {
    totalRevenue: totals?.totalRevenue ?? 0,
    totalCommission: totals?.totalCommission ?? 0,
    totalClicks: totals?.totalClicks ?? 0,
    totalOrders: totals?.totalOrders ?? 0,
    byPlatform,
  };
}

/**
 * Get earnings breakdown by platform with percentage of total.
 * Useful for pie/bar charts. Optionally scoped to a single creator.
 */
export async function getEarningsByPlatform(
  creatorId?: string,
  days = 30
): Promise<PlatformBreakdown[]> {
  const conditions = [
    sql`${platformEarnings.syncedAt} >= NOW() - MAKE_INTERVAL(days => ${days})`,
  ];

  if (creatorId) {
    conditions.push(eq(platformEarnings.creatorId, creatorId));
  }

  const whereClause = and(...conditions);

  const rows = await db
    .select({
      platform: platformEarnings.platform,
      revenue: sql<number>`CAST(COALESCE(SUM(${platformEarnings.revenue}), 0) AS FLOAT)`,
    })
    .from(platformEarnings)
    .where(whereClause)
    .groupBy(platformEarnings.platform)
    .orderBy(sql`CAST(COALESCE(SUM(${platformEarnings.revenue}), 0) AS FLOAT) DESC`);

  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);

  return rows.map((row) => ({
    platform: row.platform,
    revenue: row.revenue,
    percentage: totalRevenue > 0 ? Math.round((row.revenue / totalRevenue) * 10000) / 100 : 0,
  }));
}
