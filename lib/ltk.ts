const LTK_SERVICE_BASE_URL = process.env.LTK_SERVICE_BASE_URL;

export interface LtkOverview {
  posts_count: number;
  avg_posts_per_week: number;
  top_retailer: string;
  total_products: number;
  posts_per_day: { date: string; count: number }[];
  top_retailers: { name: string; count: number }[];
  recent_posts: {
    id: string;
    share_url: string;
    hero_image: string;
    caption: string;
    date_published: string;
    product_count: number;
  }[];
  date_range: { start: string; end: string };
}

export async function fetchLtkOverview(slug: string): Promise<LtkOverview | null> {
  if (!slug) return null;
  if (!LTK_SERVICE_BASE_URL) return null;

  const baseUrl = LTK_SERVICE_BASE_URL.replace(/\/+$/, "");
  const url = `${baseUrl}/api/ltk/${encodeURIComponent(slug)}/data`;

  const res = await fetch(url, { next: { revalidate: 60 } });

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as LtkOverview;
}

import { db } from "./db";
import { platformEarnings, sales } from "./schema";

const LTK_GATEWAY = "https://api-gateway.rewardstyle.com";

interface LTKTokens {
  accessToken: string;
  idToken: string;
}

/**
 * Fetch LTK tokens from Airtable (managed by n8n rotation workflow every 4h).
 * Falls back to env vars if Airtable is unavailable.
 */
export async function getLTKTokens(): Promise<LTKTokens> {
  const airtableToken = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (airtableToken && baseId) {
    try {
      const res = await fetch(
        `https://api.airtable.com/v0/${baseId}/LTK_Credentials?maxRecords=1&sort%5B0%5D%5Bfield%5D=Last_Refreshed&sort%5B0%5D%5Bdirection%5D=desc`,
        {
          headers: { Authorization: `Bearer ${airtableToken}` },
          next: { revalidate: 0 },
        }
      );
      if (res.ok) {
        const data = await res.json();
        const record = data.records?.[0]?.fields;
        if (record?.Access_Token && record?.ID_Token) {
          return {
            accessToken: record.Access_Token,
            idToken: record.ID_Token,
          };
        }
      }
    } catch (e) {
      console.error("Failed to fetch LTK tokens from Airtable:", e);
    }
  }

  // Fallback to env vars
  if (process.env.LTK_ACCESS_TOKEN && process.env.LTK_ID_TOKEN) {
    return {
      accessToken: process.env.LTK_ACCESS_TOKEN,
      idToken: process.env.LTK_ID_TOKEN,
    };
  }

  throw new Error("No LTK tokens available");
}

/**
 * Make an authenticated request to api-gateway.rewardstyle.com.
 * Requires both Authorization + x-id-token headers, plus Origin/Referer
 * spoofed to creator.shopltk.com — confirmed via HAR analysis.
 */
export async function ltkFetch<T>(
  path: string,
  tokens: LTKTokens,
  options?: RequestInit
): Promise<T> {
  const url = `${LTK_GATEWAY}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      "x-id-token": tokens.idToken,
      "Content-Type": "application/json",
      "Origin": "https://creator.shopltk.com",
      "Referer": "https://creator.shopltk.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      ...(options?.headers || {}),
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LTK API ${res.status}: ${errText}`);
  }

  return res.json();
}

/**
 * Fetch LTK commissions summary (lifetime + open earnings).
 * Endpoint confirmed via HAR: /api/creator-analytics/v1/commissions_summary
 */
export async function fetchLTKCommissionsSummary(tokens: LTKTokens) {
  return ltkFetch<{
    commissions_summary: {
      updated_at: string;
      currency: string;
      payment_due: number;
      open_earnings: number;
      lifetime_paid: number;
      lifetime_open_closed: number;
    };
  }>("/api/creator-analytics/v1/commissions_summary?currency=USD", tokens);
}

/**
 * Fetch LTK performance summary for a date range.
 * Endpoint confirmed via HAR: /api/creator-analytics/v1/performance_summary
 */
export async function fetchLTKPerformanceStats(
  tokens: LTKTokens,
  startDate: string,
  endDate: string,
  publisherId: string
) {
  const params = new URLSearchParams({
    start_date: `${startDate}T00:00:00Z`,
    end_date: `${endDate}T23:59:59Z`,
    publisher_ids: publisherId,
    platform: "rs,ltk",
    timezone: "UTC",
  });

  return ltkFetch<{
    data: {
      clicks: number;
      items_sold: number;
      net_commissions: number;
      orders: number;
      currency: string;
      last_updated_timestamp: string;
    };
    meta: Record<string, string>;
  }>(`/api/creator-analytics/v1/performance_summary?${params}`, tokens);
}

/**
 * Fetch individual LTK sales transactions for a date range.
 * Endpoint confirmed via HAR: /api/creator-analytics/v1/items_sold/
 */
export async function fetchLTKItemsSold(
  tokens: LTKTokens,
  startDate: string,
  endDate: string,
  limit = 100
) {
  const params = new URLSearchParams({
    limit: String(limit),
    start: `${startDate}T00:00:00.000Z`,
    end: `${endDate}T23:59:59.000Z`,
    currency: "USD",
  });

  return ltkFetch<{
    items_sold: Array<{
      event_type: string;
      amount: { currency: string; value: string };
      event_timestamp: string;
      advertiser_display_name: string;
      product_title: string;
      product_id: string;
      product_url: string;
      status: string;
      publisher_id: number;
    }>;
  }>(`/api/creator-analytics/v1/items_sold/?${params}`, tokens);
}
