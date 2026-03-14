#!/usr/bin/env python3
"""
Amazon Associates Data Sync
============================
Fetches monthly earnings from Amazon Associates Central and writes to the
creator-metrics Postgres DB. Must run on the local Windows machine — Amazon's WAF
blocks datacenter IPs (Vercel/Railway). Called daily by Task Scheduler.

Usage:
    python3 tools/amazon-data-sync.py
    python3 tools/amazon-data-sync.py --creator nicki
    python3 tools/amazon-data-sync.py --months 12   # sync last N months (default: 6)
    python3 tools/amazon-data-sync.py --days 90     # days back for daily data (default: 90)
    python3 tools/amazon-data-sync.py --dry-run     # print without writing to DB
"""
# Fix Windows cp1252 stdout encoding
import sys
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import argparse
import subprocess
import json
import urllib.request
import urllib.parse
from calendar import monthrange
from datetime import datetime, timezone, timedelta


BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

VERCEL_PUSH_URL = "https://creator-metrics.vercel.app/api/admin/amazon-data-push"

TAGS = {
    "nicki": "nickientenman-20",
    "ann":   "annschulte-20",
    "ellen": "ellenludwig-20",
    "emily": "livefitwithem-20",
}


def get_secret(key: str, project: str = "ent-agency-analytics", config: str = "prd") -> str:
    result = subprocess.run(
        ["doppler", "secrets", "get", key, "--project", project, "--config", config, "--plain"],
        capture_output=True,
    )
    return result.stdout.decode('utf-8', errors='replace').strip()


def build_headers(cookies: str, csrf: str, bearer: str, customer: str, marketplace: str, tag: str) -> dict:
    h = {
        "Cookie": cookies,
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
    if bearer:
        h["Authorization"] = f"Bearer {bearer}"
    return h


def fetch_monthly_summary(headers: dict, tag: str, year: int, month: int):
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
            data = json.loads(resp.read().decode())
            records = data.get("records") or []
            if not records:
                return {"revenue": "0", "commission": "0", "clicks": 0, "orders": 0,
                        "period_start": start, "period_end": end}
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
        body = e.read().decode(errors='replace')[:200]
        print(f"  WARN {year}-{month:02d}: HTTP {e.code} {body[:80]}")
        return None
    except Exception as e:
        print(f"  WARN {year}-{month:02d}: {e}")
        return None


def fetch_daily_earnings(headers: dict, tag: str, start: str, end: str):
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
            data = json.loads(resp.read().decode())
            return data.get("records") or []
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')[:200]
        print(f"  WARN daily fetch: HTTP {e.code} {body[:80]}")
        return None
    except Exception as e:
        print(f"  WARN daily fetch: {e}")
        return None


def push_to_vercel(creator_id: str, monthly_rows: list, daily_rows: list, order_rows: list) -> dict:
    cron_secret = get_secret("CRON_SECRET", project="ent-agency-automation", config="dev")
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
    cookies   = get_secret(f"{prefix}_COOKIES")
    csrf      = get_secret(f"{prefix}_CSRF_TOKEN")
    bearer    = get_secret(f"{prefix}_BEARER_TOKEN")
    customer  = get_secret(f"{prefix}_CUSTOMER_ID")
    marketplace = get_secret(f"{prefix}_MARKETPLACE_ID") or "ATVPDKIKX0DER"
    tag = TAGS.get(creator, f"{creator}entenman-20")

    if not cookies:
        print(f"ERROR: Missing {prefix}_COOKIES in Doppler. Run capture-amazon-request.py first.")
        return

    headers = build_headers(cookies, csrf, bearer, customer, marketplace, tag)

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
    creator_db_id = f"{creator}_entenmann"

    monthly_payload = []
    for year, month in sorted(periods):
        row = fetch_monthly_summary(headers, tag, year, month)
        if row is None:
            continue
        print(f"  {year}-{month:02d}: revenue={row.get('revenue','0')} "
              f"commission={row.get('commission','0')} "
              f"clicks={row.get('clicks',0)} orders={row.get('orders',0)}")
        monthly_payload.append(row)

    print(f"\n[{creator}] Fetching daily earnings (last {days} days)...")
    day_end = now.date()
    day_start = day_end - timedelta(days=days - 1)
    daily_rows = fetch_daily_earnings(headers, tag, str(day_start), str(day_end))

    if daily_rows is None:
        print("  WARN: Daily fetch failed -- skipping")
        daily_rows = []
    else:
        for r in daily_rows:
            if "commission_earnings" in r and "commission" not in r:
                r["commission"] = r.pop("commission_earnings")
        print(f"  {len(daily_rows)} daily rows fetched")
        if dry_run:
            for r in daily_rows[:3]:
                print(f"    {r}")
            if len(daily_rows) > 3:
                print(f"    ... and {len(daily_rows) - 3} more")

    if dry_run:
        print(f"\n  [dry-run] {creator}: {len(monthly_payload)} months, {len(daily_rows)} daily -- not written")
        return

    print(f"\n[{creator}] Pushing to DB via Vercel endpoint...")
    try:
        result = push_to_vercel(creator_db_id, monthly_payload, daily_rows, [])
        m = result.get("results", {}).get("monthly", {})
        d = result.get("results", {}).get("daily", {})
        print(f"  OK monthly={m.get('upserted',0)} daily={d.get('upserted',0)}")
        errs = result.get("total_errors", 0)
        if errs:
            print(f"  WARN {errs} errors -- check response")
    except Exception as e:
        print(f"  ERROR Push failed: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync Amazon Associates earnings to DB")
    parser.add_argument("--creator", default="nicki", choices=["nicki", "ann", "ellen", "emily", "all"])
    parser.add_argument("--months", type=int, default=6)
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    creators = ["nicki", "ann", "ellen", "emily"] if args.creator == "all" else [args.creator]
    for c in creators:
        try:
            sync_creator(c, args.months, args.days, args.dry_run)
        except Exception as e:
            print(f"\nERROR {c}: {e}")
            sys.exit(1)
