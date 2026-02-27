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

const LTK_API_BASE = "https://api-gateway.rewardstyle.com";

interface LTKTokens {
  accessToken: string;
  idToken: string;
}

/**
 * Fetch LTK tokens from Airtable (managed by n8n rotation workflow every 8h).
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
 * Make an authenticated request to the LTK API gateway.
 */
export async function ltkFetch<T>(
  path: string,
  tokens: LTKTokens,
  options?: RequestInit
): Promise<T> {
  const url = `${LTK_API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      "X-id-token": tokens.idToken,
      "Content-Type": "application/json",
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
 * Fetch LTK items sold (detailed sales) for a date range.
 */
export async function fetchLTKItemsSold(
  tokens: LTKTokens,
  startDate: string,
  endDate: string,
  publisherIds?: string
) {
  const params = new URLSearchParams({
    start: startDate,
    end: endDate,
    limit: "100",
  });
  if (publisherIds) params.set("publisher_ids", publisherIds);

  return ltkFetch<{ items?: any[]; data?: any[] }>(
    `/api/v1/analytics/items-sold?${params}`,
    tokens
  );
}

/**
 * Fetch LTK commissions summary.
 */
export async function fetchLTKCommissionsSummary(tokens: LTKTokens) {
  return ltkFetch<{ data?: any }>(
    "/api/v1/analytics/commissions-summary",
    tokens
  );
}

/**
 * Fetch LTK performance stats for a date range.
 */
export async function fetchLTKPerformanceStats(
  tokens: LTKTokens,
  startDate: string,
  endDate: string,
  publisherIds?: string
) {
  const params = new URLSearchParams({
    start: startDate,
    end: endDate,
  });
  if (publisherIds) params.set("publisher_ids", publisherIds);

  return ltkFetch<any>(
    `/api/v1/analytics/performance-stats?${params}`,
    tokens
  );
}
