"""
Amazon Associates sync — auto-refreshing cookie auth + new Reporting API.

Auth flow:
  1. Check if current cookies still work (quick health check)
  2. If expired -> HTTP re-login with email + password + x-main (no 2FA needed)
  3. If x-main expired -> TOTP fallback
  4. Fresh cookies saved to Doppler

Data flow:
  1. Load reporting page to extract Bearer JWT + CSRF token
  2. POST /reporting/export to trigger async CSV generation
  3. Poll /reporting/export/status until COMPLETED
  4. Download ZIP, parse trackingid CSV -> upsert to platform_earnings

First-time setup: run extract_amazon_cookies.py locally.
"""
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from amazon_auth import CREATORS, refresh_cookies_if_needed
from amazon_reporting_api import fetch_earnings

logger = logging.getLogger(__name__)


def sync_amazon(conn) -> dict:
    """
    Main entry point. Called by Railway sync service.
    Auto-refreshes cookies, then pulls earnings via Reporting API.
    """
    today = date.today()
    period_start = date(today.year, today.month, 1)
    if today.month == 12:
        period_end = date(today.year + 1, 1, 1) - timedelta(days=1)
    else:
        period_end = date(today.year, today.month + 1, 1) - timedelta(days=1)

    synced_at = datetime.now(timezone.utc)
    logger.info("Amazon sync — period: %s -> %s", period_start, period_end)
    results = []

    for creator in CREATORS:
        creator_id = creator["id"]
        store_id = creator.get("tag")

        if not store_id:
            logger.info("Skipping %s — no associate tag configured", creator_id)
            results.append({"creator": creator_id, "status": "skipped", "reason": "no tag"})
            continue

        logger.info("=== Syncing Amazon for %s (tag: %s) ===", creator_id, store_id)

        # Step 1: Refresh cookies if needed
        cookies = refresh_cookies_if_needed(creator)
        if not cookies:
            results.append({
                "creator": creator_id,
                "status": "auth_failed",
                "reason": "cookie refresh failed — check logs and Doppler secrets",
            })
            continue

        # Step 2: Fetch earnings via Reporting API
        customer_id = os.environ.get(creator.get("customer_id_env", ""), "") or None

        try:
            earnings = fetch_earnings(
                session_cookies=cookies,
                store_id=store_id,
                start_date=period_start,
                end_date=period_end,
                customer_id_override=customer_id,
            )

            if not earnings:
                results.append({"creator": creator_id, "status": "no_data"})
                continue

            conn.execute(
                """
                INSERT INTO platform_earnings
                    (creator_id, platform, period_start, period_end,
                     revenue, commission, clicks, orders, synced_at)
                VALUES (, 'amazon', , , , , , , )
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
            logger.info("Amazon sync OK for %s: %s", creator_id, earnings)

        except Exception as e:
            logger.error("Amazon sync failed for %s: %s", creator_id, e, exc_info=True)
            results.append({"creator": creator_id, "status": "error", "error": str(e)})

    return {"synced": synced_at.isoformat(), "results": results}
