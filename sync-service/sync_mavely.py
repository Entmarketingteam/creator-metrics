"""
Mavely GraphQL sync — direct API, no n8n or Airtable dependency.
Authenticates via NextAuth (creators.mave.ly), fetches link metrics +
individual transactions, writes to Supabase platform_earnings + mavely_links.

Multi-creator support:
  Creator list is loaded from the Supabase `creators` table at sync time.
  Any creator with a non-null `mavely_creator_id` column is eligible.

  Credentials are stored in Doppler as env vars. The naming convention is:
    MAVELY_{CREATOR_KEY}_EMAIL / MAVELY_{CREATOR_KEY}_PASSWORD
  where CREATOR_KEY is derived from creator_id (uppercase).

  The first creator (nicki_entenmann) uses legacy env var names for
  backwards compatibility: MAVELY_EMAIL / MAVELY_PASSWORD.

  To add a creator:
    1. Set `mavely_creator_id` on their row in the `creators` table
    2. Store creds in Doppler: MAVELY_{CREATOR_KEY}_EMAIL / MAVELY_{CREATOR_KEY}_PASSWORD
"""
import os, logging
from datetime import datetime, timedelta
from urllib.parse import urlencode
import httpx

logger = logging.getLogger(__name__)

CREATORS_BASE = "https://creators.mave.ly"
GRAPH_BASE    = "https://mavely.live"
CLIENT_HEADERS = {
    "client-name": "@mavely/creator-app",
    "client-version": "1.4.2",
    "client-revision": "71e8d2f8",
}

# Env-var naming overrides for backwards compatibility.
# Maps creator_id → (email_env, password_env).
_MAVELY_CREDENTIAL_OVERRIDES = {
    "nicki_entenmann": ("MAVELY_EMAIL", "MAVELY_PASSWORD"),
}


def _mavely_env_vars(creator_id: str) -> tuple[str, str]:
    """Return (email_env, password_env) for a given creator_id."""
    if creator_id in _MAVELY_CREDENTIAL_OVERRIDES:
        return _MAVELY_CREDENTIAL_OVERRIDES[creator_id]
    key = creator_id.upper()
    return (f"MAVELY_{key}_EMAIL", f"MAVELY_{key}_PASSWORD")


def _get_mavely_creators(conn) -> list[dict]:
    """
    Query the creators table for all creators with a Mavely creator ID.
    Returns a list of dicts with creator_id, email_env, password_env.
    """
    rows = conn.fetch(
        "SELECT id, mavely_creator_id FROM creators WHERE mavely_creator_id IS NOT NULL"
    )
    creators = []
    for row in rows:
        creator_id = row["id"]
        email_env, password_env = _mavely_env_vars(creator_id)
        creators.append({
            "creator_id": creator_id,
            "mavely_creator_id": row["mavely_creator_id"],
            "email_env": email_env,
            "password_env": password_env,
        })
    logger.info("Loaded %d Mavely-enabled creators from DB: %s",
                len(creators), [c["creator_id"] for c in creators])
    return creators


# ── Auth ─────────────────────────────────────────────────────────────────────

def get_mavely_token(email: str, password: str) -> str:
    jar: dict[str, str] = {}

    def extract_cookies(resp: httpx.Response) -> dict:
        cookies: dict = {}
        for h in resp.headers.get_list("set-cookie"):
            pair = h.split(";")[0]
            eq_idx = pair.find("=")
            if eq_idx < 0:
                continue
            cookies[pair[:eq_idx].strip()] = pair[eq_idx + 1:].strip()
        return cookies

    with httpx.Client(follow_redirects=False, timeout=30) as client:
        # 1. Get CSRF
        r = client.get(f"{CREATORS_BASE}/api/auth/csrf",
                       headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        csrf = r.json()["csrfToken"]
        jar.update(extract_cookies(r))

        # 2. Sign in
        r2 = client.post(
            f"{CREATORS_BASE}/api/auth/callback/credentials",
            content=urlencode({
                "csrfToken": csrf,
                "email": email,
                "password": password,
                "redirect": "false",
                "json": "true",
            }).encode(),
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0",
                "Cookie": "; ".join(f"{k}={v}" for k, v in jar.items()),
            },
        )
        jar.update(extract_cookies(r2))

        # 3. Get session JWT
        r3 = client.get(
            f"{CREATORS_BASE}/api/auth/session",
            headers={
                "User-Agent": "Mozilla/5.0",
                "Cookie": "; ".join(f"{k}={v}" for k, v in jar.items()),
            },
        )
        r3.raise_for_status()
        token = r3.json().get("token")
        if not token:
            raise RuntimeError("Mavely session missing token — login likely failed")
        return token


# ── GraphQL client ────────────────────────────────────────────────────────────

def _gql(token: str, query: str, variables: dict) -> dict:
    with httpx.Client(timeout=60) as client:
        r = client.post(
            f"{GRAPH_BASE}/",
            json={"query": query, "variables": variables},
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
                **CLIENT_HEADERS,
            },
        )
        r.raise_for_status()
        data = r.json()
        if data.get("errors"):
            raise RuntimeError(f"Mavely GQL error: {data['errors'][0]['message']}")
        return data.get("data", {})


LINK_METRICS_QUERY = """
  query($v1: CreatorAnalyticsWhereInput!, $v2: CreatorAnalyticsOrderByInput, $v3: Int, $v4: Int) {
    creatorAnalyticsMetricsByEntity(where: $v1, orderBy: $v2, first: $v3, skip: $v4) {
      affiliateLinkMetrics {
        affiliateLink { id link metaTitle metaImage brand { name } }
        metrics { clicksCount commission sales salesCount }
      }
    }
  }
"""

REPORTS_QUERY = """
  query($v1: ReportWhereInput, $v2: ReportOrderByInput, $v3: Int, $v4: Int, $v5: String) {
    allReports(where: $v1, orderBy: $v2, first: $v3, skip: $v4, after: $v5) {
      pageInfo { hasNextPage endCursor }
      edges {
        node { id date status saleAmount userCommission referrer link { id link } }
      }
    }
  }
"""


def fetch_link_metrics(token: str, start: str, end: str) -> list[dict]:
    results, skip, page = [], 0, 100
    while True:
        data = _gql(token, LINK_METRICS_QUERY, {
            "v1": {"cstDateStr_gte": start, "cstDateStr_lte": end, "entity": "LINK"},
            "v2": "sales_DESC",
            "v3": page,
            "v4": skip,
        })
        rows = data.get("creatorAnalyticsMetricsByEntity", {}).get("affiliateLinkMetrics") or []
        for row in rows:
            lnk = row.get("affiliateLink")
            if not lnk:
                continue
            m = row.get("metrics", {})
            results.append({
                "link_id": lnk["id"],
                "link_url": lnk.get("link"),
                "title": lnk.get("metaTitle"),
                "image_url": lnk.get("metaImage"),
                "clicks": m.get("clicksCount", 0),
                "orders": m.get("salesCount", 0),
                "commission": m.get("commission", 0),
                "revenue": m.get("sales", 0),
            })
        if len(rows) < page:
            break
        skip += page
    return results


def fetch_transactions(token: str, start: str, end: str, max_pages: int = 50) -> list[dict]:
    results, cursor, page, page_num = [], None, 100, 0
    while page_num < max_pages:
        page_num += 1
        data = _gql(token, REPORTS_QUERY, {
            "v1": {"date_gte": start, "date_lte": end},
            "v2": "date_DESC",
            "v3": page,
            "v4": 0,
            "v5": cursor,
        })
        report = data.get("allReports", {})
        edges = report.get("edges", [])
        for edge in edges:
            n = edge["node"]
            results.append({
                "transaction_id": n["id"],
                "link_id": n.get("link", {}).get("id") if n.get("link") else None,
                "link_url": n.get("link", {}).get("link") if n.get("link") else None,
                "referrer": n.get("referrer"),
                "commission": n.get("userCommission", 0),
                "order_value": n.get("saleAmount", 0),
                "sale_date": n.get("date"),
                "status": n.get("status"),
            })
        if not report.get("pageInfo", {}).get("hasNextPage") or not edges:
            break
        cursor = report["pageInfo"]["endCursor"]
    return results


# ── Main sync ─────────────────────────────────────────────────────────────────

def _sync_one_creator(conn, creator_id: str, token: str, now: datetime) -> dict:
    """Run the full Mavely sync for a single authenticated creator."""
    from datetime import date as _date

    # 90d window for link metrics (aggregates)
    start      = (now - timedelta(days=90)).strftime("%Y-%m-%d")
    end        = now.strftime("%Y-%m-%d")
    start_date = (now - timedelta(days=90)).date()
    end_date   = now.date()

    # Fetch link metrics
    links = fetch_link_metrics(token, start, end)
    logger.info("Mavely [%s]: fetched %d link metrics", creator_id, len(links))

    # Bulk upsert link metrics (one round-trip)
    conn.executemany("""
        INSERT INTO mavely_links
          (creator_id, mavely_link_id, link_url, title, image_url,
           period_start, period_end, clicks, orders, commission, revenue, synced_at)
        VALUES ($11, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (creator_id, mavely_link_id, period_start, period_end)
        DO UPDATE SET clicks=$7, orders=$8, commission=$9, revenue=$10,
                      link_url=$2, title=$3, image_url=$4, synced_at=NOW()
    """, [
        (lnk["link_id"], lnk["link_url"], lnk["title"], lnk["image_url"],
         start_date, end_date, lnk["clicks"], lnk["orders"],
         str(lnk["commission"]), str(lnk["revenue"]), creator_id)
        for lnk in links
    ])
    links_upserted = len(links)

    # Skip per-transaction insert — mavely_transactions has legacy schema (0002 migration)
    # Dashboard uses platform_earnings only; transactions can be backfilled later.
    tx_inserted = 0
    logger.info("Mavely [%s]: skipping transaction insert (schema migration needed)", creator_id)

    # Upsert platform_earnings summary for the current calendar month.
    # Using a fixed calendar-month period (first→last day of current month) means
    # each run upserts the same row in-place — no accumulation of overlapping windows.
    today = now.date()
    month_start = _date(today.year, today.month, 1)
    # last day of current month: day 0 of next month
    if today.month == 12:
        month_end = _date(today.year + 1, 1, 1) - timedelta(days=1)
    else:
        month_end = _date(today.year, today.month + 1, 1) - timedelta(days=1)

    # Fetch link metrics for the current month window
    month_start_str = month_start.strftime("%Y-%m-%d")
    month_links = fetch_link_metrics(token, month_start_str, end)
    total_commission = sum(float(l["commission"]) for l in month_links)
    total_revenue    = sum(float(l["revenue"]) for l in month_links)
    total_clicks     = sum(l["clicks"] for l in month_links)
    total_orders     = sum(l["orders"] for l in month_links)

    conn.execute("""
        INSERT INTO platform_earnings
          (creator_id, platform, period_start, period_end, revenue, commission, clicks, orders, synced_at)
        VALUES ($1, 'mavely', $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (creator_id, platform, period_start, period_end)
        DO UPDATE SET revenue=$4, commission=$5, clicks=$6, orders=$7, synced_at=NOW()
    """,
    creator_id,
    month_start, month_end,
    str(total_revenue),
    str(total_commission),
    total_clicks,
    total_orders)

    return {
        "creator": creator_id,
        "period": f"{start} → {end}",
        "links_upserted": links_upserted,
        "tx_inserted": tx_inserted,
    }


def sync_mavely(conn) -> dict:
    """Sync Mavely data for all creators with mavely_creator_id in the DB."""
    now = datetime.utcnow()

    # Load creators from DB instead of hardcoded list
    mavely_creators = _get_mavely_creators(conn)
    if not mavely_creators:
        logger.warning("No creators found with mavely_creator_id set — nothing to sync")
        return {"status": "ok", "synced": [], "skipped": []}

    results = []
    skipped = []

    for creator in mavely_creators:
        creator_id   = creator["creator_id"]
        email        = os.environ.get(creator["email_env"])
        password     = os.environ.get(creator["password_env"])

        if not email or not password:
            logger.warning(
                "Skipping %s — missing Mavely credentials (%s / %s). "
                "Store in Doppler to enable sync.",
                creator_id,
                creator["email_env"],
                creator["password_env"],
            )
            skipped.append(creator_id)
            continue

        logger.info("Mavely: authenticating for %s...", creator_id)
        try:
            token = get_mavely_token(email, password)
            logger.info("Mavely [%s]: authenticated successfully", creator_id)
        except Exception as e:
            logger.error("Mavely [%s]: authentication failed — %s", creator_id, e)
            results.append({"creator": creator_id, "status": "error", "error": str(e)})
            continue

        try:
            result = _sync_one_creator(conn, creator_id, token, now)
            result["status"] = "ok"
            results.append(result)
        except Exception as e:
            logger.error("Mavely [%s]: sync failed — %s", creator_id, e)
            results.append({"creator": creator_id, "status": "error", "error": str(e)})

    return {
        "status": "ok",
        "synced": results,
        "skipped": skipped,
    }
