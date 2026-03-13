"""
Amazon Associates sync — auto-refreshing cookie auth.

Auth flow:
  1. Check if current cookies (SESSION_COOKIES + X_MAIN) still work
  2. If not → HTTP re-login with email + password + x-main (no 2FA needed — trusted device)
  3. If x-main expired → use TOTP seed to generate 2FA code and complete full login
  4. Fresh cookies saved back to Doppler automatically

First-time setup: run extract_amazon_cookies.py locally.
"""
import csv
import io
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import httpx

from amazon_auth import CREATORS, refresh_cookies_if_needed

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://affiliate-program.amazon.com/home",
}


def _download_csv(cookies: dict, start_date: str, end_date: str) -> Optional[str]:
    """Download earnings CSV using current session cookies."""
    url = (
        "https://affiliate-program.amazon.com/home/reports/download"
        f"?reportType=earning&dateRangeValue=custom"
        f"&startDate={start_date}&endDate={end_date}"
    )
    logger.info("Downloading earnings CSV: %s → %s", start_date, end_date)

    with httpx.Client(follow_redirects=True, timeout=30) as client:
        resp = client.get(url, headers=_HEADERS, cookies=cookies)

    if resp.status_code != 200:
        logger.warning("CSV download returned %d", resp.status_code)
        return None

    content = resp.text
    if "ap_email" in content or "signin" in str(resp.url).lower():
        logger.warning("Redirected to login after cookie refresh — auth failed completely")
        return None

    if len(content) < 20 or "Date" not in content:
        logger.warning("CSV looks empty (len=%d)", len(content))
        return None

    return content


def _parse_csv(csv_content: str) -> Optional[dict]:
    """
    Aggregate an Amazon earnings CSV into totals.
    Returns { clicks, orders, revenue, commission }
    """
    try:
        reader = csv.DictReader(io.StringIO(csv_content))
        total_clicks = total_orders = 0
        total_commission = 0.0
        rows_read = 0

        for row in reader:
            date_val = (row.get("Date") or "").strip().lower()
            if not date_val or date_val in ("", "date", "total", "totals"):
                continue

            def _num(keys, is_float=False):
                for k in keys:
                    v = (row.get(k) or "").replace(",", "").replace("$", "").strip()
                    if v:
                        try:
                            return float(v) if is_float else int(float(v))
                        except ValueError:
                            continue
                return 0.0 if is_float else 0

            total_clicks += _num(["Clicks", "clicks"])
            total_orders += _num(["Shipped Items", "shipped_items", "Ordered Items", "ordered_items"])
            total_commission += _num(
                ["Total Commissions", "total_commissions", "Revenue", "revenue"],
                is_float=True,
            )
            rows_read += 1

        if rows_read == 0:
            logger.warning("CSV parsed 0 data rows")
            return None

        return {
            "clicks": total_clicks,
            "orders": total_orders,
            "revenue": round(total_commission, 2),
            "commission": round(total_commission, 2),
        }
    except Exception as e:
        logger.error("CSV parse error: %s", e)
        return None


def sync_amazon(conn) -> dict:
    """
    Main entry point. Called by Railway sync service.
    Auto-refreshes cookies before syncing.
    """
    today = date.today()
    period_start = date(today.year, today.month, 1)
    if today.month == 12:
        period_end = date(today.year + 1, 1, 1) - timedelta(days=1)
    else:
        period_end = date(today.year, today.month + 1, 1) - timedelta(days=1)

    start_str = period_start.isoformat()
    end_str = period_end.isoformat()
    synced_at = datetime.now(timezone.utc)

    logger.info("Amazon sync — period: %s → %s", start_str, end_str)
    results = []

    for creator in CREATORS:
        creator_id = creator["id"]
        logger.info("=== Syncing Amazon for %s ===", creator_id)

        # Auto-refresh cookies — HTTP re-login if expired, TOTP if x-main gone
        cookies = refresh_cookies_if_needed(creator)
        if not cookies:
            results.append({
                "creator": creator_id,
                "status": "auth_failed",
                "reason": "cookie refresh failed — check logs and Doppler secrets",
            })
            continue

        try:
            csv_content = _download_csv(cookies, start_str, end_str)
            if not csv_content:
                results.append({"creator": creator_id, "status": "no_data"})
                continue

            earnings = _parse_csv(csv_content)
            if not earnings:
                results.append({"creator": creator_id, "status": "parse_failed"})
                continue

            conn.execute(
                """
                INSERT INTO platform_earnings
                    (creator_id, platform, period_start, period_end,
                     revenue, commission, clicks, orders, synced_at)
                VALUES ($1, 'amazon', $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (creator_id, platform, period_start, period_end)
                DO UPDATE SET
                    revenue    = EXCLUDED.revenue,
                    commission = EXCLUDED.commission,
                    clicks     = EXCLUDED.clicks,
                    orders     = EXCLUDED.orders,
                    synced_at  = EXCLUDED.synced_at
                """,
                creator_id,
                period_start,
                period_end,
                str(earnings["revenue"]),
                str(earnings["commission"]),
                earnings["clicks"],
                earnings["orders"],
                synced_at,
            )
            results.append({
                "creator": creator_id,
                "status": "ok",
                "clicks": earnings["clicks"],
                "orders": earnings["orders"],
                "commission": earnings["commission"],
            })
            logger.info("✓ Amazon sync for %s: %s", creator_id, earnings)

        except Exception as e:
            logger.error("Amazon sync failed for %s: %s", creator_id, e, exc_info=True)
            results.append({"creator": creator_id, "status": "error", "error": str(e)})

    return {"synced": synced_at.isoformat(), "results": results}
