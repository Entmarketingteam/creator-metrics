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


BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

# Vercel push endpoint — handles the DB write (local Mac can't reach Supabase ports directly)
VERCEL_PUSH_URL = "https://creator-metrics.vercel.app/api/admin/amazon-data-push"


def get_secret(key: str, project: str = "ent-agency-automation", config: str = "dev") -> str:
    result = subprocess.run(
        ["doppler", "secrets", "get", key, "--project", project, "--config", config, "--plain"],
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
    """Fetch daily breakdown via summary endpoint with group_by=day.
    Returns list of row dicts (one per day) or None on error.
    NOTE: /reporting/table returns 500 — use /reporting/summary with group_by=day instead.
    """
    params = urllib.parse.urlencode({
        "query[start_date]": start,
        "query[end_date]": end,
        "query[type]": "earning",
        "query[group_by]": "day",
        "store_id": tag,
    })
    url = f"https://affiliate-program.amazon.com/reporting/summary?{params}"
    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status != 200:
                print(f"  ⚠ daily fetch: HTTP {resp.status}")
                return None
            data = json.loads(resp.read().decode())
            return data.get("records") or []
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
    """Amazon's per-ASIN API (/reporting/table) returns 500 consistently.
    Returns empty list — per-ASIN data is not available via the JSON API.
    """
    # The /reporting/table endpoint with type=orders returns HTTP 500.
    # Returning empty list so daily sync proceeds normally.
    return []


def trigger_intelligence(creator_db_id: str) -> None:
    """Trigger post-sync intelligence analysis and Slack notification."""
    cron_secret = get_secret("CRON_SECRET")
    vercel_url = "https://creator-metrics.vercel.app/api/admin/sync-intelligence"
    payload = json.dumps({"creator_id": creator_db_id}).encode()
    req = urllib.request.Request(
        vercel_url,
        data=payload,
        headers={
            "Authorization": f"Bearer {cron_secret}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            print(f"  📊 Intelligence: {data.get('summary', 'sent to Slack')}")
    except Exception as e:
        print(f"  ⚠ Intelligence trigger failed (non-blocking): {e}")


def push_to_vercel(creator_id: str, monthly_rows: list, daily_rows: list, order_rows: list) -> dict:
    """POST all collected rows to the Vercel push endpoint, which writes to Supabase."""
    cron_secret = get_secret("CRON_SECRET")
    payload = json.dumps({
        "creator_id": creator_id,
        "monthly_rows": monthly_rows,
        "daily_rows": daily_rows,
        "order_rows": order_rows,
    }).encode()
    req = urllib.request.Request(
        VERCEL_PUSH_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {cron_secret}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


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

    # Creator ID in DB (convention: {first_name}_entenmann)
    creator_db_id = f"{creator}_entenmann"

    monthly_payload = []
    for year, month in sorted(periods):
        row = fetch_monthly_summary(headers, tag, year, month)
        if row is None:
            continue

        revenue = row.get("revenue", "0")
        commission = row.get("commission", "0")
        clicks = row.get("clicks", 0)
        orders = row.get("orders", 0)

        print(f"  {year}-{month:02d}: revenue={revenue} commission={commission} clicks={clicks} orders={orders}")
        monthly_payload.append(row)

    # ── Daily earnings (last N days) ───────────────────────────────────
    print(f"\n[{creator}] Fetching daily earnings (last {days} days)...")
    day_end = now.date()
    day_start = day_end - timedelta(days=days - 1)
    daily_rows = fetch_daily_earnings(headers, tag, str(day_start), str(day_end))

    if daily_rows is None:
        print(f"  ⚠ Daily fetch failed — skipping")
        daily_rows = []
    else:
        # Normalize commission field name from API
        for r in daily_rows:
            if "commission_earnings" in r and "commission" not in r:
                r["commission"] = r.pop("commission_earnings")
        print(f"  {len(daily_rows)} daily rows fetched")
        if dry_run:
            for r in daily_rows[:3]:
                print(f"    {r}")
            if len(daily_rows) > 3:
                print(f"    ... and {len(daily_rows) - 3} more")

    # ── Per-ASIN orders (last N days) ──────────────────────────────────
    print(f"\n[{creator}] Fetching per-ASIN orders (last {days} days)...")
    order_rows = fetch_orders(headers, tag, str(day_start), str(day_end))

    if order_rows is None:
        print(f"  ⚠ Orders fetch failed — skipping")
        order_rows = []
    else:
        # Add period dates and normalize field name
        for r in order_rows:
            r["period_start"] = str(day_start)
            r["period_end"] = str(day_end)
            if "product_title" in r and "title" not in r:
                r["title"] = r.pop("product_title")
        print(f"  {len(order_rows)} order rows fetched")
        if dry_run:
            for r in order_rows[:3]:
                print(f"    {r}")
            if len(order_rows) > 3:
                print(f"    ... and {len(order_rows) - 3} more")

    if dry_run:
        print(f"\n  [dry-run] {creator}: {len(monthly_payload)} months, {len(daily_rows)} daily, {len(order_rows)} orders — not written")
        return

    # ── Push everything to Vercel → Supabase ───────────────────────────
    print(f"\n[{creator}] Pushing to DB via Vercel endpoint...")
    push_ok = False
    try:
        result = push_to_vercel(creator_db_id, monthly_payload, daily_rows, order_rows)
        m = result.get("results", {}).get("monthly", {})
        d = result.get("results", {}).get("daily", {})
        o = result.get("results", {}).get("orders", {})
        print(f"  ✅ monthly={m.get('upserted',0)} daily={d.get('upserted',0)} orders={o.get('upserted',0)}")
        errs = result.get("total_errors", 0)
        if errs:
            print(f"  ⚠ {errs} errors — check response")
        push_ok = True
    except Exception as e:
        print(f"  ❌ Push failed: {e}")

    # ── Post-sync intelligence (non-blocking) ──────────────────────────
    if push_ok:
        trigger_intelligence(creator_db_id)


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
