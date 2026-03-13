#!/usr/bin/env python3
"""
Amazon Associates Data Sync
============================
Fetches monthly earnings from Amazon Associates Central and writes to the
creator-metrics Postgres DB. Must run on the local Mac — Amazon's WAF blocks
datacenter IPs (Vercel/Railway). Called daily by LaunchAgent.

Usage:
    python3 tools/amazon-data-sync.py
    python3 tools/amazon-data-sync.py --creator nicki
    python3 tools/amazon-data-sync.py --months 12   # sync last N months (default: 6)
    python3 tools/amazon-data-sync.py --days 90     # days back for daily/orders data (default: 90)
    python3 tools/amazon-data-sync.py --dry-run      # print without writing to DB
"""

import argparse
import subprocess
import sys
import json
import urllib.request
import urllib.parse
from calendar import monthrange
from datetime import datetime, timezone, timedelta

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    sys.exit("ERROR: psycopg2 not installed. Run: pip3 install psycopg2-binary")


BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def get_secret(key: str, project: str = "ent-agency-automation") -> str:
    result = subprocess.run(
        ["doppler", "secrets", "get", key, "--project", project, "--config", "dev", "--plain"],
        capture_output=True, text=True
    )
    return result.stdout.strip()


def build_headers(cookies: str, bearer: str, csrf: str, customer: str, marketplace: str, tag: str) -> dict:
    return {
        "Cookie": cookies,
        "Authorization": f"Bearer {bearer}",
        "X-Csrf-Token": csrf,
        "X-Requested-With": "XMLHttpRequest",
        "customerid": customer,
        "marketplaceid": marketplace,
        "programid": "1",
        "roles": "Primary",
        "storeid": tag,
        "language": "en_US",
        "locale": "en_US",
        "User-Agent": BROWSER_UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://affiliate-program.amazon.com/",
    }


def fetch_monthly_summary(headers: dict, tag: str, year: int, month: int):
    """Fetch summary totals for one calendar month. Returns None on error."""
    last_day = monthrange(year, month)[1]
    start = f"{year}-{month:02d}-01"
    end = f"{year}-{month:02d}-{last_day:02d}"

    params = urllib.parse.urlencode({
        "query[start_date]": start,
        "query[end_date]": end,
        "query[type]": "earning",
        "store_id": tag,
    })
    url = f"https://affiliate-program.amazon.com/reporting/summary?{params}"
    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status != 200:
                print(f"  ⚠ {year}-{month:02d}: HTTP {resp.status}")
                return None
            data = json.loads(resp.read().decode())
            records = data.get("records") or []
            if not records:
                return {"revenue": "0", "commission": "0", "clicks": 0, "orders": 0}
            rec = records[0]
            return {
                "period_start": start,
                "period_end": end,
                "revenue": str(round(float(rec.get("revenue") or 0), 2)),
                "commission": str(round(float(rec.get("commission_earnings") or 0), 2)),
                "clicks": int(rec.get("clicks") or 0),
                "orders": int(rec.get("ordered_items") or 0),
                "raw_payload": json.dumps(rec),
            }
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode()[:200]
        except Exception:
            pass
        print(f"  ⚠ {year}-{month:02d}: HTTP {e.code} {body[:80]}")
        return None
    except Exception as e:
        print(f"  ⚠ {year}-{month:02d}: {e}")
        return None


def fetch_daily_earnings(headers: dict, tag: str, start: str, end: str):
    """Fetch daily breakdown for a date range. Returns list of row dicts or None on error."""
    params = urllib.parse.urlencode({
        "query[type]": "earnings",
        "query[start_date]": start,
        "query[end_date]": end,
        "query[group_by]": "day",
        "query[columns]": "day,clicks,shipped_items,ordered_items,revenue,commission_earnings",
        "query[limit]": "90",
        "store_id": tag,
    })
    url = f"https://affiliate-program.amazon.com/reporting/table?{params}"
    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status != 200:
                print(f"  ⚠ daily fetch: HTTP {resp.status}")
                return None
            data = json.loads(resp.read().decode())
            return data.get("rows") or []
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode()[:200]
        except Exception:
            pass
        print(f"  ⚠ daily fetch: HTTP {e.code} {body[:80]}")
        return None
    except Exception as e:
        print(f"  ⚠ daily fetch: {e}")
        return None


def fetch_orders(headers: dict, tag: str, start: str, end: str):
    """Fetch per-ASIN orders for a date range. Returns list of row dicts or None on error."""
    params = urllib.parse.urlencode({
        "query[type]": "orders",
        "query[start_date]": start,
        "query[end_date]": end,
        "query[columns]": "asin,product_title,ordered_items,shipped_items,revenue,commission",
        "query[limit]": "200",
        "store_id": tag,
    })
    url = f"https://affiliate-program.amazon.com/reporting/table?{params}"
    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status != 200:
                print(f"  ⚠ orders fetch: HTTP {resp.status}")
                return None
            data = json.loads(resp.read().decode())
            return data.get("rows") or []
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode()[:200]
        except Exception:
            pass
        print(f"  ⚠ orders fetch: HTTP {e.code} {body[:80]}")
        return None
    except Exception as e:
        print(f"  ⚠ orders fetch: {e}")
        return None


def upsert_platform_earnings(conn, creator_id: str, row: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO platform_earnings
                (creator_id, platform, period_start, period_end, revenue, commission, clicks, orders, raw_payload, synced_at)
            VALUES (%s, 'amazon', %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (creator_id, platform, period_start, period_end)
            DO UPDATE SET
                revenue = EXCLUDED.revenue,
                commission = EXCLUDED.commission,
                clicks = EXCLUDED.clicks,
                orders = EXCLUDED.orders,
                raw_payload = EXCLUDED.raw_payload,
                synced_at = NOW()
            """,
            (
                creator_id,
                row["period_start"],
                row["period_end"],
                row["revenue"],
                row["commission"],
                row["clicks"],
                row["orders"],
                row.get("raw_payload"),
            ),
        )
    conn.commit()


def upsert_daily_earnings(conn, creator_id: str, rows: list) -> int:
    """Upsert daily rows into amazon_daily_earnings. Returns count inserted/updated."""
    count = 0
    with conn.cursor() as cur:
        for row in rows:
            try:
                cur.execute(
                    """
                    INSERT INTO amazon_daily_earnings
                        (creator_id, day, clicks, ordered_items, shipped_items, revenue, commission, synced_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (creator_id, day) DO UPDATE SET
                        clicks = EXCLUDED.clicks,
                        ordered_items = EXCLUDED.ordered_items,
                        shipped_items = EXCLUDED.shipped_items,
                        revenue = EXCLUDED.revenue,
                        commission = EXCLUDED.commission,
                        synced_at = EXCLUDED.synced_at
                    """,
                    (
                        creator_id,
                        row.get("day"),
                        int(row.get("clicks") or 0),
                        int(row.get("ordered_items") or 0),
                        int(row.get("shipped_items") or 0),
                        str(round(float(row.get("revenue") or 0), 2)),
                        str(round(float(row.get("commission_earnings") or 0), 2)),
                    ),
                )
                count += 1
            except Exception as e:
                print(f"  ⚠ daily upsert row {row.get('day')}: {e}")
    conn.commit()
    return count


def upsert_orders(conn, creator_id: str, period_start: str, period_end: str, rows: list) -> int:
    """Upsert per-ASIN rows into amazon_orders. Returns count inserted/updated."""
    count = 0
    with conn.cursor() as cur:
        for row in rows:
            try:
                cur.execute(
                    """
                    INSERT INTO amazon_orders
                        (creator_id, period_start, period_end, asin, title, ordered_items, shipped_items, revenue, commission, synced_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (creator_id, period_start, asin) DO UPDATE SET
                        title = EXCLUDED.title,
                        ordered_items = EXCLUDED.ordered_items,
                        shipped_items = EXCLUDED.shipped_items,
                        revenue = EXCLUDED.revenue,
                        commission = EXCLUDED.commission,
                        synced_at = EXCLUDED.synced_at
                    """,
                    (
                        creator_id,
                        period_start,
                        period_end,
                        row.get("asin"),
                        row.get("product_title"),
                        int(row.get("ordered_items") or 0),
                        int(row.get("shipped_items") or 0),
                        str(round(float(row.get("revenue") or 0), 2)),
                        str(round(float(row.get("commission") or 0), 2)),
                    ),
                )
                count += 1
            except Exception as e:
                print(f"  ⚠ orders upsert row {row.get('asin')}: {e}")
    conn.commit()
    return count


def sync_creator(creator: str, months: int, days: int, dry_run: bool) -> None:
    prefix = f"AMAZON_{creator.upper()}"
    cookies = get_secret(f"{prefix}_COOKIES")
    bearer = get_secret(f"{prefix}_BEARER_TOKEN")
    csrf = get_secret(f"{prefix}_CSRF_TOKEN")
    customer = get_secret(f"{prefix}_CUSTOMER_ID")
    marketplace = get_secret(f"{prefix}_MARKETPLACE_ID") or "ATVPDKIKX0DER"
    tag = f"{creator}entenman-20"

    if not cookies or not bearer:
        print(f"❌ Missing Doppler secrets for {creator}. Run amazon-cookie-refresh.py first.")
        return

    headers = build_headers(cookies, bearer, csrf, customer, marketplace, tag)

    # Build list of (year, month) to sync
    now = datetime.now(timezone.utc)
    periods = []
    y, m = now.year, now.month
    for _ in range(months):
        periods.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1

    print(f"\n[{creator}] Syncing {len(periods)} months...")

    if not dry_run:
        db_url = get_secret("DATABASE_URL")
        conn = psycopg2.connect(db_url)

    # Creator ID in DB (convention: {first_name}_entenmann)
    creator_db_id = f"{creator}_entenmann"

    synced = 0
    for year, month in sorted(periods):
        row = fetch_monthly_summary(headers, tag, year, month)
        if row is None:
            continue

        revenue = row.get("revenue", "0")
        commission = row.get("commission", "0")
        clicks = row.get("clicks", 0)
        orders = row.get("orders", 0)

        print(f"  {year}-{month:02d}: revenue={revenue} commission={commission} clicks={clicks} orders={orders}", end="")

        if dry_run:
            print(" [dry-run]")
        else:
            upsert_platform_earnings(conn, creator_db_id, row)
            print(" ✓")
            synced += 1

    if not dry_run:
        print(f"\n  ✅ {creator}: {synced} months upserted")

    # ── Daily earnings (last N days) ───────────────────────────────────
    print(f"\n[{creator}] Fetching daily earnings (last {days} days)...")
    day_end = now.date()
    day_start = day_end - timedelta(days=days - 1)
    daily_rows = fetch_daily_earnings(headers, tag, str(day_start), str(day_end))

    if daily_rows is None:
        print(f"  ⚠ Daily fetch failed — skipping (monthly sync still complete)")
    elif dry_run:
        print(f"  [dry-run] {len(daily_rows)} daily rows would be upserted")
        for r in daily_rows[:3]:
            print(f"    {r}")
        if len(daily_rows) > 3:
            print(f"    ... and {len(daily_rows) - 3} more")
    else:
        count = upsert_daily_earnings(conn, creator_db_id, daily_rows)
        print(f"  ✅ {count} daily rows upserted")

    # ── Per-ASIN orders (last N days) ──────────────────────────────────
    print(f"\n[{creator}] Fetching per-ASIN orders (last {days} days)...")
    order_rows = fetch_orders(headers, tag, str(day_start), str(day_end))

    if order_rows is None:
        print(f"  ⚠ Orders fetch failed — skipping (monthly sync still complete)")
    elif dry_run:
        print(f"  [dry-run] {len(order_rows)} order rows would be upserted")
        for r in order_rows[:3]:
            print(f"    {r}")
        if len(order_rows) > 3:
            print(f"    ... and {len(order_rows) - 3} more")
    else:
        count = upsert_orders(conn, creator_db_id, str(day_start), str(day_end), order_rows)
        print(f"  ✅ {count} order rows upserted")

    if not dry_run:
        conn.close()
    else:
        print(f"\n  [dry-run] {creator}: done")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync Amazon Associates earnings to DB")
    parser.add_argument("--creator", default="nicki", choices=["nicki", "ann", "ellen", "emily", "all"])
    parser.add_argument("--months", type=int, default=6, help="Number of past months to sync (default: 6)")
    parser.add_argument("--days", type=int, default=90, help="Number of days back for daily/orders data (default: 90)")
    parser.add_argument("--dry-run", action="store_true", help="Print data without writing to DB")
    args = parser.parse_args()

    creators = ["nicki", "ann", "ellen", "emily"] if args.creator == "all" else [args.creator]
    for c in creators:
        try:
            sync_creator(c, args.months, args.days, args.dry_run)
        except Exception as e:
            print(f"\n❌ {c}: {e}")
            sys.exit(1)
