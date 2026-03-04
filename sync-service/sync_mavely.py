"""
Mavely GraphQL sync — direct API, no n8n or Airtable dependency.
Authenticates via NextAuth (creators.mave.ly), fetches link metrics +
individual transactions, writes to Supabase platform_earnings + mavely_links.
"""
import os, logging
from datetime import datetime, timedelta
import httpx

logger = logging.getLogger(__name__)

CREATORS_BASE = "https://creators.mave.ly"
GRAPH_BASE    = "https://mavely.live"
CLIENT_HEADERS = {
    "client-name": "@mavely/creator-app",
    "client-version": "1.4.2",
    "client-revision": "71e8d2f8",
}


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
            content=httpx.QueryParams({
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


def fetch_transactions(token: str, start: str, end: str) -> list[dict]:
    results, cursor, page = [], None, 100
    while True:
        data = _gql(token, REPORTS_QUERY, {
            "v1": {"date_gte": start, "date_lte": end},
            "v2": "date_DESC",
            "v3": page,
            "v4": 0,
            "v5": cursor,
        })
        report = data.get("allReports", {})
        for edge in report.get("edges", []):
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
        if not report.get("pageInfo", {}).get("hasNextPage"):
            break
        cursor = report["pageInfo"]["endCursor"]
    return results


# ── Main sync ─────────────────────────────────────────────────────────────────

def sync_mavely(conn) -> dict:
    email    = os.environ["MAVELY_EMAIL"]
    password = os.environ["MAVELY_PASSWORD"]

    token = get_mavely_token(email, password)
    logger.info("Mavely authenticated successfully")

    now   = datetime.utcnow()
    start = (now - timedelta(days=90)).strftime("%Y-%m-%d")
    end   = now.strftime("%Y-%m-%d")

    # Fetch link metrics
    links = fetch_link_metrics(token, start, end)
    logger.info("Mavely: fetched %d link metrics", len(links))

    links_upserted = 0
    for lnk in links:
        conn.execute("""
            INSERT INTO mavely_links
              (creator_id, mavely_link_id, link_url, title, image_url,
               period_start, period_end, clicks, orders, commission, revenue, synced_at)
            VALUES ('nicki_entenmann', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            ON CONFLICT (creator_id, mavely_link_id, period_start, period_end)
            DO UPDATE SET clicks=$7, orders=$8, commission=$9, revenue=$10,
                          link_url=$2, title=$3, image_url=$4, synced_at=NOW()
        """,
        lnk["link_id"], lnk["link_url"], lnk["title"], lnk["image_url"],
        start, end, lnk["clicks"], lnk["orders"],
        str(lnk["commission"]), str(lnk["revenue"]))
        links_upserted += 1

    # Fetch transactions
    txns = fetch_transactions(token, start, end)
    logger.info("Mavely: fetched %d transactions", len(txns))

    tx_inserted = 0
    for tx in txns:
        try:
            conn.execute("""
                INSERT INTO mavely_transactions
                  (creator_id, mavely_transaction_id, mavely_link_id, link_url,
                   referrer, commission_amount, order_value, sale_date, status, synced_at)
                VALUES ('nicki_entenmann', $1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT (mavely_transaction_id) DO NOTHING
            """,
            tx["transaction_id"], tx["link_id"], tx["link_url"], tx["referrer"],
            str(tx["commission"]), str(tx["order_value"]),
            tx["sale_date"], tx["status"])
            tx_inserted += 1
        except Exception:
            pass

    # Upsert platform_earnings summary (total commission over last 30d)
    thirty_day_start = (now - timedelta(days=30)).strftime("%Y-%m-%d")
    thirty_day_links = fetch_link_metrics(token, thirty_day_start, end)
    total_commission_30d = sum(float(l["commission"]) for l in thirty_day_links)

    conn.execute("""
        INSERT INTO platform_earnings
          (creator_id, platform, period_start, period_end, revenue, commission, clicks, orders, synced_at)
        VALUES ('nicki_entenmann', 'mavely', $1, $2, $3, $3, $4, $5, NOW())
        ON CONFLICT (creator_id, platform, period_start, period_end)
        DO UPDATE SET revenue=$3, commission=$3, clicks=$4, orders=$5, synced_at=NOW()
    """,
    thirty_day_start, end,
    str(total_commission_30d),
    sum(l["clicks"] for l in thirty_day_links),
    sum(l["orders"] for l in thirty_day_links))

    return {
        "status": "ok",
        "period": f"{start} → {end}",
        "links_upserted": links_upserted,
        "tx_inserted": tx_inserted,
    }
