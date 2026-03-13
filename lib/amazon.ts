const ASSOCIATES_BASE = "https://affiliate-program.amazon.com";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export interface AmazonSession {
  cookieHeader: string;
  associateTag: string;
  bearerToken?: string;
  csrfToken?: string;
  customerId?: string;
  marketplaceId?: string;
}

export interface AmazonDailyEarnings {
  day: string; // YYYY-MM-DD
  clicks: number;
  shippedItems: number;
  orderedItems: number;
  revenue: number;
  commissionEarnings: number;
}

export interface AmazonOrder {
  date: string;
  asin: string;
  title: string;
  orderedItems: number;
  revenue: number;
  commission: number;
}

/** Shared request helper — injects session cookies + browser headers. */
async function amazonFetch(
  url: string,
  session: AmazonSession,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${ASSOCIATES_BASE}/`,
    Cookie: session.cookieHeader,
    "X-Requested-With": "XMLHttpRequest",
    language: "en_US",
    locale: "en_US",
    programid: "1",
    roles: "Primary",
    storeid: session.associateTag,
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (session.bearerToken) {
    headers["Authorization"] = `Bearer ${session.bearerToken}`;
  }
  if (session.csrfToken) {
    headers["X-Csrf-Token"] = session.csrfToken;
  }
  if (session.customerId) {
    headers["customerid"] = session.customerId;
  }
  if (session.marketplaceId) {
    headers["marketplaceid"] = session.marketplaceId;
  }

  return fetch(url, { ...options, headers });
}

/**
 * Fetch daily earnings summary for a date range.
 * Maps to: GET /reporting/table?query[type]=earnings&query[group_by]=day
 */
export async function fetchDailyEarnings(
  session: AmazonSession,
  startDate: string,
  endDate: string
): Promise<AmazonDailyEarnings[]> {
  const params = new URLSearchParams({
    "query[type]": "earnings",
    "query[start_date]": startDate,
    "query[end_date]": endDate,
    "query[tag_id]": "all",
    "query[group_by]": "day",
    "query[order]": "desc",
    "query[columns]":
      "day,clicks,shipped_items,ordered_items,revenue,commission_earnings",
    "query[skip]": "0",
    "query[limit]": "100",
    "query[sort]": "day",
    store_id: session.associateTag,
  });

  const url = `${ASSOCIATES_BASE}/reporting/table?${params}`;
  const res = await amazonFetch(url, session);

  if (res.status === 401) {
    throw new Error(
      `Amazon session expired (401). Refresh cookies via amazon-cookie-refresh.py.`
    );
  }
  if (!res.ok) {
    throw new Error(`Amazon /reporting/table failed: ${res.status}`);
  }

  const data = await res.json();
  const rows: any[] = data?.data?.rows ?? data?.rows ?? [];

  return rows.map((row: any) => ({
    day: row.day ?? row[0] ?? "",
    clicks: Number(row.clicks ?? row[1] ?? 0),
    shippedItems: Number(row.shipped_items ?? row[2] ?? 0),
    orderedItems: Number(row.ordered_items ?? row[3] ?? 0),
    revenue: parseFloat(row.revenue ?? row[4] ?? "0"),
    commissionEarnings: parseFloat(row.commission_earnings ?? row[5] ?? "0"),
  }));
}

/**
 * Fetch per-product orders for a date range.
 * Maps to: GET /reporting/table?query[type]=orders
 */
export async function fetchOrders(
  session: AmazonSession,
  startDate: string,
  endDate: string,
  limit = 200
): Promise<AmazonOrder[]> {
  const params = new URLSearchParams({
    "query[type]": "orders",
    "query[start_date]": startDate,
    "query[end_date]": endDate,
    "query[columns]": "product_title,asin,ordered_items,revenue,commission",
    "query[group_by]": "none",
    "query[sort]": "ordered_items",
    "query[order]": "desc",
    "query[skip]": "0",
    "query[limit]": String(limit),
    store_id: session.associateTag,
  });

  const url = `${ASSOCIATES_BASE}/reporting/table?${params}`;
  const res = await amazonFetch(url, session);

  if (res.status === 401) {
    throw new Error(
      `Amazon session expired (401). Refresh cookies via amazon-cookie-refresh.py.`
    );
  }
  if (!res.ok) {
    throw new Error(`Amazon /reporting/table (orders) failed: ${res.status}`);
  }

  const data = await res.json();
  const rows: any[] = data?.data?.rows ?? data?.rows ?? [];

  return rows.map((row: any) => ({
    date: startDate, // orders endpoint groups by ASIN, not day
    asin: row.asin ?? "",
    title: row.product_title ?? "",
    orderedItems: Number(row.ordered_items ?? 0),
    revenue: parseFloat(row.revenue ?? "0"),
    commission: parseFloat(row.commission ?? "0"),
  }));
}

/**
 * Fetch monthly summary totals via the summary endpoint.
 * Returns { totalRevenue, totalCommission, totalClicks } for the period.
 */
export async function fetchEarningsSummary(
  session: AmazonSession,
  startDate: string,
  endDate: string
): Promise<{ revenue: number; commission: number; clicks: number }> {
  const params = new URLSearchParams({
    "query[start_date]": startDate,
    "query[end_date]": endDate,
    "query[type]": "earning",
    store_id: session.associateTag,
  });

  const url = `${ASSOCIATES_BASE}/reporting/summary?${params}`;
  const res = await amazonFetch(url, session);

  if (res.status === 401) {
    throw new Error(
      `Amazon session expired (401). Refresh cookies via amazon-cookie-refresh.py.`
    );
  }
  if (!res.ok) {
    // Summary is non-critical — return zeros rather than failing the whole sync
    console.warn(`[amazon] summary fetch failed: ${res.status}`);
    return { revenue: 0, commission: 0, clicks: 0 };
  }

  const data = await res.json();
  return {
    revenue: parseFloat(data?.revenue ?? data?.totalRevenue ?? "0"),
    commission: parseFloat(
      data?.commission_earnings ?? data?.totalCommission ?? "0"
    ),
    clicks: Number(data?.clicks ?? data?.totalClicks ?? 0),
  };
}
