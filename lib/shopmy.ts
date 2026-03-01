const SHOPMY_API_BASE = "https://apiv3.shopmy.us";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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
      "User-Agent": BROWSER_UA,
      Origin: "https://shopmy.us",
      Referer: "https://shopmy.us/",
    },
    body: JSON.stringify({ username: email, password }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ShopMy login failed ${res.status}: ${errText}`);
  }

  // Collect Set-Cookie headers — use getSetCookie() (Node 18.14+) for reliable
  // multi-cookie parsing. Each entry is a single "name=value; attrs..." string.
  const setCookieList: string[] =
    (res.headers as any).getSetCookie?.() ??
    [res.headers.get("set-cookie") ?? ""].filter(Boolean);

  // Extract name=value from each Set-Cookie string (everything before first ';')
  const allCookies: string[] = setCookieList
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean);

  // Extract CSRF token from the shopmy_csrf_token cookie
  const csrfRaw = setCookieList
    .find((c) => c.trimStart().startsWith("shopmy_csrf_token="))
    ?.split(";")[0]
    ?.split("=")
    .slice(1)
    .join("=") ?? "";

  if (!csrfRaw) {
    throw new Error("ShopMy login: shopmy_csrf_token cookie not found");
  }

  const decoded = decodeURIComponent(csrfRaw);
  const uuidMatch = decoded.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  const csrfToken = uuidMatch ? uuidMatch[0] : decoded;

  // Build Cookie header
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
      "User-Agent": BROWSER_UA,
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
