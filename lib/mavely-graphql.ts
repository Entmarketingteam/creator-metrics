/**
 * Mavely GraphQL client
 *
 * Auth flow: NextAuth credentials at creators.mave.ly
 *   1. GET /api/auth/csrf → csrfToken + cookie
 *   2. POST /api/auth/callback/credentials → session cookie
 *   3. GET /api/auth/session → { token } (JWT Bearer for mavely.live GraphQL)
 *
 * Required headers on mavely.live requests:
 *   client-name: @mavely/creator-app
 *   client-version: 1.4.2
 *   client-revision: 71e8d2f8
 */

const CREATORS_BASE = "https://creators.mave.ly";
const GRAPH_BASE = "https://mavely.live";

const CLIENT_HEADERS = {
  "client-name": "@mavely/creator-app",
  "client-version": "1.4.2",
  "client-revision": "71e8d2f8",
};

// ── Cookie helpers ──────────────────────────────────────────────────

function extractSetCookies(res: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  const raw: string[] =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];

  for (const entry of raw) {
    const [pair] = entry.split(";");
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 0) continue;
    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ── Auth ────────────────────────────────────────────────────────────

export async function getMavelyToken(email: string, password: string): Promise<string> {
  const jar: Record<string, string> = {};

  // 1. Fetch CSRF token
  const csrfRes = await fetch(`${CREATORS_BASE}/api/auth/csrf`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!csrfRes.ok) throw new Error(`Mavely CSRF fetch failed: ${csrfRes.status}`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  Object.assign(jar, extractSetCookies(csrfRes));

  // 2. Sign in with credentials
  const signInRes = await fetch(`${CREATORS_BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0",
      Cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      redirect: "false",
      json: "true",
    }).toString(),
    redirect: "manual",
    cache: "no-store",
  });
  Object.assign(jar, extractSetCookies(signInRes));

  // 3. Fetch session — contains the JWT Bearer token
  const sessionRes = await fetch(`${CREATORS_BASE}/api/auth/session`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Cookie: cookieHeader(jar),
    },
    cache: "no-store",
  });
  if (!sessionRes.ok) throw new Error(`Mavely session fetch failed: ${sessionRes.status}`);
  const session = (await sessionRes.json()) as { token?: string };
  if (!session.token) throw new Error("Mavely session missing token — login may have failed");
  return session.token;
}

// ── GraphQL client ──────────────────────────────────────────────────

async function graphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...CLIENT_HEADERS,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Mavely GraphQL ${res.status}: ${txt.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`Mavely GQL error: ${json.errors[0].message}`);
  if (!json.data) throw new Error("Mavely GQL: no data returned");
  return json.data;
}

// ── Per-link metrics ────────────────────────────────────────────────

export interface MavelyLinkMetric {
  linkId: string;
  linkUrl: string | null;
  title: string | null;      // metaTitle in API
  imageUrl: string | null;   // metaImage in API
  brandName: string | null;
  clicks: number;            // clicksCount in API
  orders: number;            // salesCount in API
  commission: number;        // creator's share (userCommission at report level)
  revenue: number;           // sales (gross order value)
}

// Exact query structure from HAR analysis
const LINK_METRICS_QUERY = `
  query ($v1: CreatorAnalyticsWhereInput!, $v2: CreatorAnalyticsOrderByInput, $v3: Int, $v4: Int) {
    creatorAnalyticsMetricsByEntity(where: $v1, orderBy: $v2, first: $v3, skip: $v4) {
      affiliateLinkMetrics {
        affiliateLink {
          id
          link
          metaTitle
          metaImage
          brand { id name }
        }
        metrics {
          clicksCount
          commission
          sales
          salesCount
          conversion
        }
      }
    }
  }
`;

export async function fetchLinkMetrics(
  token: string,
  startDate: string,
  endDate: string
): Promise<MavelyLinkMetric[]> {
  const PAGE = 100;
  const results: MavelyLinkMetric[] = [];
  let skip = 0;

  while (true) {
    const data = await graphql<{
      creatorAnalyticsMetricsByEntity: {
        affiliateLinkMetrics: {
          affiliateLink: {
            id: string;
            link?: string;
            metaTitle?: string;
            metaImage?: string;
            brand?: { id: string; name: string };
          } | null;
          metrics: {
            clicksCount?: number;
            commission?: number;
            sales?: number;
            salesCount?: number;
          };
        }[] | null;
      };
    }>(token, LINK_METRICS_QUERY, {
      v1: {
        cstDateStr_gte: startDate,
        cstDateStr_lte: endDate,
        entity: "LINK",
      },
      v2: "sales_DESC",
      v3: PAGE,
      v4: skip,
    });

    const rows = data.creatorAnalyticsMetricsByEntity?.affiliateLinkMetrics ?? [];
    for (const row of rows) {
      if (!row.affiliateLink) continue;
      results.push({
        linkId: row.affiliateLink.id,
        linkUrl: row.affiliateLink.link ?? null,
        title: row.affiliateLink.metaTitle ?? null,
        imageUrl: row.affiliateLink.metaImage ?? null,
        brandName: row.affiliateLink.brand?.name ?? null,
        clicks: row.metrics.clicksCount ?? 0,
        orders: row.metrics.salesCount ?? 0,
        commission: row.metrics.commission ?? 0,
        revenue: row.metrics.sales ?? 0,
      });
    }

    if (rows.length < PAGE) break;
    skip += PAGE;
  }

  return results;
}

// ── Individual transactions ─────────────────────────────────────────

export interface MavelyTransaction {
  transactionId: string;
  linkId: string | null;
  linkUrl: string | null;
  referrer: string | null;
  commissionAmount: number;   // userCommission — creator's net
  orderValue: number;         // saleAmount — gross order value
  saleDate: string | null;    // date field (not createdAt)
  status: string | null;
}

// Exact query structure from HAR analysis (cursor-based pagination)
const REPORTS_QUERY = `
  query ($v1: ReportWhereInput, $v2: ReportOrderByInput, $v3: Int, $v4: Int, $v5: String) {
    allReports(where: $v1, orderBy: $v2, first: $v3, skip: $v4, after: $v5) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          date
          status
          saleAmount
          userCommission
          type
          productName
          referrer
          link { id link }
        }
      }
    }
  }
`;

export async function fetchTransactions(
  token: string,
  startDate: string,
  endDate: string
): Promise<MavelyTransaction[]> {
  const PAGE = 100;
  const results: MavelyTransaction[] = [];
  let cursor: string | null = null;

  while (true) {
    const data = await graphql<{
      allReports: {
        pageInfo: { hasNextPage: boolean; endCursor: string };
        edges: {
          node: {
            id: string;
            date?: string;
            status?: string;
            saleAmount?: number;
            userCommission?: number;
            referrer?: string;
            link?: { id: string; link?: string } | null;
          };
        }[];
      };
    }>(token, REPORTS_QUERY, {
      v1: { date_gte: startDate, date_lte: endDate },
      v2: "date_DESC",
      v3: PAGE,
      v4: 0,
      v5: cursor,
    });

    const { edges, pageInfo } = data.allReports;
    for (const { node } of edges) {
      results.push({
        transactionId: node.id,
        linkId: node.link?.id ?? null,
        linkUrl: node.link?.link ?? null,
        referrer: node.referrer ?? null,
        commissionAmount: node.userCommission ?? 0,
        orderValue: node.saleAmount ?? 0,
        saleDate: node.date ?? null,
        status: node.status ?? null,
      });
    }

    if (!pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }

  return results;
}
