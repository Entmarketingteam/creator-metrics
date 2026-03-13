"""
Amazon Associates sync — Airtop browser login + Reporting API.

Auth flow:
  1. Airtop opens a cloud browser on a residential IP
  2. Logs into Amazon Associates with email + password (+ TOTP if needed)
  3. Navigates to reporting page, extracts Bearer JWT + CSRF token from DOM
  4. Browser closes — tokens used for all subsequent API calls
  5. Fresh session cookies saved back to Doppler for next run

Data flow:
  POST /reporting/export -> poll status -> download ZIP -> parse CSV -> upsert DB
"""
import logging
import os
from datetime import date, datetime, timedelta, timezone

from amazon_auth import CREATORS, _save_to_doppler
from amazon_airtop import get_amazon_tokens
from amazon_reporting_api import fetch_earnings_with_tokens

logger = logging.getLogger(__name__)


def sync_amazon(conn) -> dict:
    """Main entry point. Called by Railway sync service."""
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

        email = os.environ.get(creator["email_env"])
        password = os.environ.get(creator["password_env"])
        totp_secret = os.environ.get(creator.get("totp_env", ""), "") or None
        customer_id = os.environ.get(creator.get("customer_id_env", ""), "") or None

        if not email or not password:
            logger.error("[%s] Missing email or password — skipping", creator_id)
            results.append({"creator": creator_id, "status": "skipped", "reason": "no credentials"})
            continue

        try:
            # Step 1: Login via Airtop browser to get fresh tokens
            logger.info("[%s] Logging in via Airtop...", creator_id)
            tokens = get_amazon_tokens(
                email=email,
                password=password,
                totp_secret=totp_secret,
                store_id=store_id,
            )

            if not tokens:
                logger.error("[%s] Airtop login failed", creator_id)
                results.append({"creator": creator_id, "status": "auth_failed",
                                 "reason": "Airtop login failed"})
                continue

            # Use customer_id from env if known, otherwise from page extraction
            cid = customer_id or tokens.get("customer_id")
            if not cid:
                logger.error("[%s] Could not determine customer ID", creator_id)
                results.append({"creator": creator_id, "status": "auth_failed",
                                 "reason": "missing customer_id"})
                continue

            # Save fresh session cookies back to Doppler for reference
            session_env = creator.get("session_env")
            if session_env and tokens.get("session_cookies"):
                from amazon_auth import SESSION_KEYS
                sc = {k: v for k, v in tokens["session_cookies"].items() if k in SESSION_KEYS}
                if sc:
                    _save_to_doppler(session_env, "; ".join(f"{k}={v}" for k, v in sc.items()))

            # Step 2: Fetch earnings using extracted tokens
            earnings = fetch_earnings_with_tokens(
                bearer=tokens["bearer"],
                csrf=tokens["csrf"],
                customer_id=cid,
                store_id=store_id,
                start_date=period_start,
                end_date=period_end,
                session_cookies=tokens["session_cookies"],
            )

            if not earnings:
                results.append({"creator": creator_id, "status": "no_data"})
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
                creator_id, period_start, period_end,
                str(earnings["revenue"]), str(earnings["commission"]),
                earnings["clicks"], earnings["orders"], synced_at,
            )
            results.append({
                "creator": creator_id, "status": "ok",
                "clicks": earnings["clicks"],
                "orders": earnings["orders"],
                "commission": earnings["commission"],
            })
            logger.info("Amazon sync OK for %s: %s", creator_id, earnings)

        except Exception as e:
            logger.error("Amazon sync failed for %s: %s", creator_id, e, exc_info=True)
            results.append({"creator": creator_id, "status": "error", "error": str(e)})

    return {"synced": synced_at.isoformat(), "results": results}
