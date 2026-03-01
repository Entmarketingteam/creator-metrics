#!/usr/bin/env python3
"""
Historical backfill — 2024-01 through 2025-12
Platforms: LTK, Mavely, ShopMy
Inserts into: platform_earnings (monthly summaries), sales (individual transactions)
"""

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from decimal import Decimal

import psycopg2
from psycopg2.extras import execute_values

# ── Config ────────────────────────────────────────────────────────────────────

DB_URL = "postgresql://postgres.jidfewontxspgylmtavp:abd4ucz2wdq-kym1AFW@aws-0-us-west-2.pooler.supabase.com:6543/postgres"
CREATOR_ID = "nicki_entenmann"
LTK_PUBLISHER_ID = "293045"
SHOPMY_USER_ID = "65244"

BACKFILL_MONTHS = []
for year in [2024, 2025]:
    for month in range(1, 13):
        BACKFILL_MONTHS.append((year, month))

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"


# ── DB helpers ─────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(DB_URL)


def upsert_platform_earnings(conn, rows):
    """rows: list of dicts with keys matching platform_earnings columns."""
    if not rows:
        return 0
    cur = conn.cursor()
    values = [(
        r["creator_id"], r["platform"], r["period_start"], r["period_end"],
        r["revenue"], r["commission"], r.get("clicks", 0), r.get("orders", 0),
        r.get("status", "open"), r.get("raw_payload"), datetime.utcnow()
    ) for r in rows]
    execute_values(cur, """
        INSERT INTO platform_earnings
            (creator_id, platform, period_start, period_end, revenue, commission, clicks, orders, status, raw_payload, synced_at)
        VALUES %s
        ON CONFLICT (creator_id, platform, period_start, period_end) DO UPDATE SET
            revenue     = EXCLUDED.revenue,
            commission  = EXCLUDED.commission,
            clicks      = EXCLUDED.clicks,
            orders      = EXCLUDED.orders,
            raw_payload = EXCLUDED.raw_payload,
            synced_at   = EXCLUDED.synced_at
    """, values)
    count = cur.rowcount
    conn.commit()
    return count


def upsert_sales(conn, rows):
    """rows: list of dicts for the sales table."""
    if not rows:
        return 0
    cur = conn.cursor()
    values = [(
        r["creator_id"], r["platform"], r["sale_date"], r.get("brand"),
        r.get("commission_amount", 0), r.get("order_value", 0),
        r.get("product_name"), r.get("status", "open"), r.get("external_order_id")
    ) for r in rows]
    execute_values(cur, """
        INSERT INTO sales
            (creator_id, platform, sale_date, brand, commission_amount, order_value, product_name, status, external_order_id)
        VALUES %s
        ON CONFLICT DO NOTHING
    """, values)
    count = cur.rowcount
    conn.commit()
    return count


# ── HTTP helper ────────────────────────────────────────────────────────────────

def http_get(url, headers):
    req = urllib.request.Request(url, headers=headers)
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def http_post(url, headers, body):
    data = json.dumps(body).encode() if isinstance(body, (dict, list)) else body.encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


# ── LTK ───────────────────────────────────────────────────────────────────────

def get_ltk_tokens():
    import subprocess, os
    airtable_key = subprocess.check_output(
        ["doppler", "secrets", "get", "AIRTABLE_API_KEY", "--project", "ent-agency-automation", "--config", "dev", "--plain"],
        text=True
    ).strip()
    airtable_base = "appQnKyfyRyhHX44h"
    url = f"https://api.airtable.com/v0/{airtable_base}/LTK_Credentials?maxRecords=1&sort%5B0%5D%5Bfield%5D=Last_Refreshed&sort%5B0%5D%5Bdirection%5D=desc"
    data = http_get(url, {"Authorization": f"Bearer {airtable_key}"})
    record = data["records"][0]["fields"]
    return record["Access_Token"], record["ID_Token"]


def ltk_fetch(path, access_token, id_token):
    url = f"https://api-gateway.rewardstyle.com{path}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "x-id-token": id_token,
        "Content-Type": "application/json",
        "Origin": "https://creator.shopltk.com",
        "Referer": "https://creator.shopltk.com/",
        "User-Agent": UA,
    }
    return http_get(url, headers)


def backfill_ltk(conn):
    print("\n=== LTK BACKFILL ===")
    access_token, id_token = get_ltk_tokens()
    print("Got LTK tokens")

    total_earnings = 0
    total_sales = 0

    for year, month in BACKFILL_MONTHS:
        period_start = date(year, month, 1)
        if month == 12:
            period_end = date(year, 12, 31)
        else:
            period_end = date(year, month + 1, 1).replace(day=1)
            period_end = date(year, month + 1, 1)
            import calendar
            last_day = calendar.monthrange(year, month)[1]
            period_end = date(year, month, last_day)

        start_str = period_start.isoformat()
        end_str = period_end.isoformat()
        label = f"{year}-{month:02d}"

        try:
            # Performance summary
            params = urllib.parse.urlencode({
                "start_date": f"{start_str}T00:00:00Z",
                "end_date": f"{end_str}T23:59:59Z",
                "publisher_ids": LTK_PUBLISHER_ID,
                "platform": "rs,ltk",
                "timezone": "UTC",
            })
            perf = ltk_fetch(f"/api/creator-analytics/v1/performance_summary?{params}", access_token, id_token)
            d = perf.get("data", {})
            clicks = d.get("clicks", 0)
            orders = d.get("orders", 0)
            revenue = d.get("net_commissions", 0)

            earnings_row = {
                "creator_id": CREATOR_ID,
                "platform": "ltk",
                "period_start": start_str,
                "period_end": end_str,
                "revenue": str(revenue),
                "commission": str(revenue),
                "clicks": clicks,
                "orders": orders,
                "raw_payload": json.dumps(d),
            }
            n = upsert_platform_earnings(conn, [earnings_row])
            total_earnings += n
            print(f"  LTK {label}: ${revenue:.2f}, {clicks} clicks, {orders} orders → {n} upserted")

            # Individual items sold
            try:
                items_params = urllib.parse.urlencode({
                    "limit": "500",
                    "start": f"{start_str}T00:00:00.000Z",
                    "end": f"{end_str}T23:59:59.000Z",
                    "currency": "USD",
                })
                items_data = ltk_fetch(f"/api/creator-analytics/v1/items_sold/?{items_params}", access_token, id_token)
                items = items_data.get("items_sold", [])
                sale_rows = []
                for item in items:
                    amt = item.get("amount", {})
                    val = float(amt.get("value", 0)) if isinstance(amt, dict) else 0
                    sale_rows.append({
                        "creator_id": CREATOR_ID,
                        "platform": "ltk",
                        "sale_date": item.get("event_timestamp", datetime.utcnow().isoformat()),
                        "brand": item.get("advertiser_display_name"),
                        "commission_amount": val,
                        "product_name": item.get("product_title"),
                        "status": item.get("status", "open"),
                        "external_order_id": item.get("product_id") or item.get("publisher_id"),
                    })
                ns = upsert_sales(conn, sale_rows)
                total_sales += ns
                if sale_rows:
                    print(f"    → {len(sale_rows)} items, {ns} new sales rows")
            except Exception as e:
                print(f"    items_sold error: {e}")

            time.sleep(0.5)

        except Exception as e:
            print(f"  LTK {label}: ERROR {e}")
            time.sleep(1)

    print(f"\nLTK done: {total_earnings} earnings rows, {total_sales} sales rows")


# ── Mavely ────────────────────────────────────────────────────────────────────

def get_mavely_session():
    """Get Mavely cookies + access token from Airtable (saved by n8n workflow)."""
    import subprocess
    airtable_key = subprocess.check_output(
        ["doppler", "secrets", "get", "AIRTABLE_API_KEY", "--project", "ent-agency-automation", "--config", "dev", "--plain"],
        text=True
    ).strip()
    url = "https://api.airtable.com/v0/appQnKyfyRyhHX44h/tbllD6GuMSSEuN0Nq"
    data = http_get(url, {"Authorization": f"Bearer {airtable_key}"})
    fields = data["records"][0]["fields"]
    cookies = fields.get("Mavely_Cookies", "")

    # Extract access token from session using stored cookies
    base = "https://creators.mave.ly"
    h = {"Origin": base, "Referer": f"{base}/", "User-Agent": UA, "Cookie": cookies}
    session_data = http_get(f"{base}/api/auth/session", h)
    access_token = session_data.get("token") or session_data.get("accessToken")
    if not access_token:
        raise Exception(f"Could not get Mavely access token from session. Session keys: {list(session_data.keys())}")
    return cookies, access_token


def mavely_graphql(cookies, access_token, period_start, period_end):
    query = "query ($v1:CreatorAnalyticsWhereInput!){creatorAnalyticsMetricsTotals(where:$v1){metrics{clicksCount,commission,sales,salesCount,conversion}}}"
    v1 = {"cstDateStr_gte": period_start, "cstDateStr_lte": period_end, "brand": {"slug_not": "amazon-deep-linking"}}
    body = json.dumps({"query": query, "variables": {"v1": v1}})
    headers = {
        "Content-Type": "application/json",
        "Origin": "https://creators.mave.ly",
        "Referer": "https://creators.mave.ly/",
        "client-name": "@mavely/creator-app",
        "client-version": "1.4.2",
        "Cookie": cookies,
        "Authorization": f"Bearer {access_token}",
        "User-Agent": UA,
    }
    req = urllib.request.Request("https://mavely.live/", data=body.encode(), headers=headers, method="POST")
    return json.loads(urllib.request.urlopen(req, timeout=15).read())


def backfill_mavely(conn):
    print("\n=== MAVELY BACKFILL ===")
    cookies, access_token = get_mavely_session()
    print("Got Mavely session")

    total = 0
    for year, month in BACKFILL_MONTHS:
        import calendar
        period_start = date(year, month, 1).isoformat()
        last_day = calendar.monthrange(year, month)[1]
        period_end = date(year, month, last_day).isoformat()
        label = f"{year}-{month:02d}"

        try:
            data = mavely_graphql(cookies, access_token, period_start, period_end)
            metrics = data.get("data", {}).get("creatorAnalyticsMetricsTotals", {}).get("metrics", {})
            commission = float(metrics.get("commission") or 0)
            clicks = int(metrics.get("clicksCount") or 0)
            orders = int(metrics.get("salesCount") or 0)

            row = {
                "creator_id": CREATOR_ID,
                "platform": "mavely",
                "period_start": period_start,
                "period_end": period_end,
                "revenue": str(commission),
                "commission": str(commission),
                "clicks": clicks,
                "orders": orders,
                "raw_payload": json.dumps(metrics),
            }
            n = upsert_platform_earnings(conn, [row])
            total += n
            print(f"  Mavely {label}: ${commission:.2f}, {clicks} clicks, {orders} orders → {n} upserted")
            time.sleep(0.4)

        except Exception as e:
            print(f"  Mavely {label}: ERROR {e}")
            # Re-login on auth errors
            if "401" in str(e) or "403" in str(e):
                try:
                    cookies, access_token = get_mavely_session()
                    print("  Re-logged in to Mavely")
                except:
                    pass
            time.sleep(1)

    print(f"\nMavely done: {total} earnings rows")


# ── ShopMy ────────────────────────────────────────────────────────────────────

def get_shopmy_session():
    base = "https://apiv3.shopmy.us"
    h = {"Content-Type": "application/json", "Origin": "https://shopmy.us", "Referer": "https://shopmy.us/", "User-Agent": UA}
    req = urllib.request.Request(f"{base}/api/Auth/session", method="POST",
        data=json.dumps({"username": "marketingteam@nickient.com", "password": "Paisleyrae710!"}).encode(), headers=h)
    resp = urllib.request.urlopen(req, timeout=15)
    cr = resp.headers.get_all("Set-Cookie") or []
    cookies = "; ".join(c.split(";")[0].strip() for c in cr)
    csrf_raw = next((c for c in cr if "shopmy_csrf_token=" in c), "")
    csrf = re.search(r"[0-9a-f-]{36}", urllib.parse.unquote(csrf_raw.split("shopmy_csrf_token=")[1].split(";")[0])).group(0)
    return cookies, csrf, h


def backfill_shopmy(conn):
    print("\n=== SHOPMY BACKFILL ===")
    cookies, csrf, h_base = get_shopmy_session()
    ah = {**h_base, "Cookie": cookies, "x-csrf-token": csrf}

    # Fetch full payout summary (contains months dict + 100 most recent commissions)
    base = "https://apiv3.shopmy.us"
    req = urllib.request.Request(f"{base}/api/Payouts/payout_summary/{SHOPMY_USER_ID}", headers=ah)
    data = json.loads(urllib.request.urlopen(req, timeout=30).read())["data"]

    # 1. Monthly summaries from the `months` dict
    months = data.get("months", {})
    earnings_rows = []
    for month_key, totals in months.items():
        try:
            # month_key format: "2/28/25" or "10/31/25"
            dt = datetime.strptime(month_key, "%m/%d/%y")
            import calendar
            last_day = calendar.monthrange(dt.year, dt.month)[1]
            period_start = date(dt.year, dt.month, 1).isoformat()
            period_end = date(dt.year, dt.month, last_day).isoformat()
            revenue = float(totals.get("user_payout_total", 0))
            earnings_rows.append({
                "creator_id": CREATOR_ID,
                "platform": "shopmy",
                "period_start": period_start,
                "period_end": period_end,
                "revenue": str(revenue),
                "commission": str(revenue),
                "raw_payload": json.dumps(totals),
            })
            print(f"  ShopMy {dt.year}-{dt.month:02d}: ${revenue:.2f}")
        except Exception as e:
            print(f"  ShopMy month parse error {month_key}: {e}")

    n_earnings = upsert_platform_earnings(conn, earnings_rows)
    print(f"  → {n_earnings} monthly earnings rows upserted")

    # 2. Individual commissions (most recent 100 — API limitation)
    normal = data.get("normal_commissions", [])
    sale_rows = []
    for c in normal:
        ext_id = str(c.get("id") or c.get("commission_id") or "")
        if not ext_id:
            continue
        sale_rows.append({
            "creator_id": CREATOR_ID,
            "platform": "shopmy",
            "sale_date": c.get("transaction_date") or datetime.utcnow().isoformat(),
            "brand": c.get("merchant"),
            "commission_amount": float(c.get("amountEarned") or c.get("commission_amount") or 0),
            "order_value": float(c.get("order_amount") or 0),
            "product_name": c.get("Product_title") or c.get("title"),
            "status": "paid" if c.get("isPaid") else ("open" if not c.get("isLocked") else "pending"),
            "external_order_id": ext_id,
        })

    n_sales = upsert_sales(conn, sale_rows)
    print(f"  → {n_sales} individual sales rows upserted (from most recent 100; API has no historical pagination)")
    print(f"\nShopMy done: {n_earnings} earnings rows, {n_sales} sales rows")


# ── LTK Posts ─────────────────────────────────────────────────────────────────

def backfill_ltk_posts(conn):
    """Fetch LTK posts/links for Nicki and store in content_master if schema supports it."""
    print("\n=== LTK POSTS BACKFILL ===")
    access_token, id_token = get_ltk_tokens()

    # Check if content_master has the right columns
    db_conn = conn
    cur = db_conn.cursor()
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='content_master'")
    cols = [r[0] for r in cur.fetchall()]
    print(f"  content_master columns: {cols}")

    # Try LTK posts endpoint
    try:
        params = urllib.parse.urlencode({
            "publisher_ids": LTK_PUBLISHER_ID,
            "limit": "100",
            "offset": "0",
        })
        data = ltk_fetch(f"/api/ltk/v2/ltks/?{params}", access_token, id_token)
        posts = data.get("ltks", data.get("data", []))
        print(f"  Got {len(posts)} LTK posts")
        if posts:
            print(f"  Sample keys: {list(posts[0].keys())[:10]}")
    except Exception as e:
        print(f"  LTK posts endpoint error: {e}")

        # Try alternative endpoint
        try:
            data = ltk_fetch(f"/api/creator/v1/publishers/{LTK_PUBLISHER_ID}/ltks?limit=50", access_token, id_token)
            posts = data.get("ltks", data.get("data", []))
            print(f"  Alt endpoint got {len(posts)} posts")
        except Exception as e2:
            print(f"  Alt endpoint also failed: {e2}")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    conn = get_conn()
    print(f"Connected to DB. Backfilling {len(BACKFILL_MONTHS)} months (2024-01 → 2025-12)")

    platforms = sys.argv[1:] or ["ltk", "mavely", "shopmy", "posts"]

    if "shopmy" in platforms:
        backfill_shopmy(conn)

    if "mavely" in platforms:
        backfill_mavely(conn)

    if "ltk" in platforms:
        backfill_ltk(conn)

    if "posts" in platforms:
        backfill_ltk_posts(conn)

    conn.close()
    print("\n✅ Backfill complete.")
