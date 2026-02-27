const SHOPMY_API_BASE = "https://apiv3.shopmy.us";

export interface ShopMySession {
  cookieHeader: string;
  csrfToken: string;
}

/**
 * Authenticate with ShopMy and return a session for subsequent requests.
 * Re-authenticate on each cron run — session cookies are short-lived.
 */
export async function loginShopMy(
  email: string,
  password: string
): Promise<ShopMySession> {
  const res = await fetch(`${SHOPMY_API_BASE}/api/Auth/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://shopmy.us",
      Referer: "https://shopmy.us/",
    },
    body: JSON.stringify({ username: email, password }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ShopMy login failed ${res.status}: ${errText}`);
  }

  // Collect Set-Cookie headers
  const setCookieHeader = res.headers.get("set-cookie") ?? "";
  const allCookies: string[] = [];

  // Node fetch returns comma-joined set-cookie — split carefully
  // Pattern: extract individual cookie name=value pairs
  const cookieMatches = setCookieHeader.matchAll(/([^=,]+=[^;]+)(?:;[^,]*)?(?:,|$)/g);
  for (const m of cookieMatches) {
    allCookies.push(m[1].trim());
  }

  // Extract CSRF token UUID from shopmy_csrf_token cookie value
  const csrfCookieMatch = setCookieHeader.match(/shopmy_csrf_token=([^;,]+)/);
  if (!csrfCookieMatch) {
    throw new Error("ShopMy login: shopmy_csrf_token cookie not found");
  }
  // The cookie value may be URL-encoded or contain extra chars — strip to UUID
  const rawCsrf = decodeURIComponent(csrfCookieMatch[1]);
  const uuidMatch = rawCsrf.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  const csrfToken = uuidMatch ? uuidMatch[0] : rawCsrf;

  // Build Cookie header from all cookies received
  const cookieHeader = allCookies.join("; ");

  return { cookieHeader, csrfToken };
}

/**
 * Make an authenticated request to the ShopMy API.
 */
export async function shopmyFetch<T>(
  path: string,
  session: ShopMySession
): Promise<T> {
  const url = `${SHOPMY_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      "x-csrf-token": session.csrfToken,
      "x-session-id": String(Date.now()),
      Origin: "https://shopmy.us",
      Referer: "https://shopmy.us/",
      Cookie: session.cookieHeader,
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ShopMy API ${res.status} ${path}: ${errText}`);
  }

  return res.json();
}

export interface ShopMyPayoutSummary {
  normal_commissions?: any[];
  opportunity_commissions?: any[];
  shopper_referral_bonuses?: any[];
  payments?: any[];
  months?: any[];
  todayAmount?: number;
}

/**
 * Fetch payout summary for a creator.
 * Response is wrapped: { data: ShopMyPayoutSummary }
 */
export async function fetchPayoutSummary(
  session: ShopMySession,
  userId: string
): Promise<ShopMyPayoutSummary> {
  const res = await shopmyFetch<{ data?: ShopMyPayoutSummary } | ShopMyPayoutSummary>(
    `/api/Payouts/payout_summary/${userId}`,
    session
  );
  // Unwrap { data: ... } envelope if present
  return (res as any).data ?? res;
}

/**
 * Parse a ShopMy dollar string like "$1,200.00" or "16.80" into a plain numeric string.
 */
export function parseShopMyAmount(value: string | number | undefined | null): string {
  if (value == null) return "0";
  return String(value).replace(/[$,]/g, "") || "0";
}

/**
 * Fetch brand-specific commission rates for a creator.
 */
export async function fetchBrandRates(
  session: ShopMySession,
  userId: string
): Promise<any[]> {
  const result = await shopmyFetch<any[] | { rates?: any[] }>(
    `/api/CustomRates/all_rates/${userId}`,
    session
  );
  return Array.isArray(result) ? result : result?.rates ?? [];
}
