"""
Amazon Associates sync — uses stored session cookies to download earnings CSV
directly via HTTP (no browser automation needed).

Cookies are extracted once locally (extract_amazon_cookies.py) and stored in Doppler.
They last several months; re-run extract script when sync starts returning auth errors.

Doppler secrets per creator:
  AMAZON_{ID}_COOKIES   e.g. AMAZON_NICKI_COOKIES   (full cookie string)
"""
import csv
import io
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

CREATORS = [
    {
        "id": "nicki_entenmann",
        "cookies_env": "AMAZON_NICKI_COOKIES",
        "tag": "nickientenmann-20",
    },
    {
        "id": "annbschulte",
        "cookies_env": "ANN_AMAZON_COOKIES",
        "tag": None,
    },
    {
        "id": "ellenludwigfitness",
        "cookies_env": "ELLEN_AMAZON_COOKIES",
        "tag": None,
    },
    {
        "id": "livefitwithem",
        "cookies_env": "EMILY_AMAZON_COOKIES",
        "tag": None,
    },
]

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


def _parse_cookie_str(cookie_str: str) -> dict:
    """Parse 'name=value; name=value' cookie string into a dict."""
    cookies = {}
    for part in cookie_str.split(";"):
        part = part.strip()
        if "=" in part:
            name, _, value = part.partition("=")
            cookies[name.strip()] = value.strip()
    return cookies


def _download_csv(cookie_str: str, start_date: str, end_date: str) -> Optional[str]:
    """Download earnings CSV using stored session cookies."""
    url = (
        "https://affiliate-program.amazon.com/home/reports/download"
        f"?reportType=earning&dateRangeValue=custom"
        f"&startDate={start_date}&endDate={end_date}"
    )
    logger.info("Downloading earnings CSV: %s", url)

    cookies = _parse_cookie_str(cookie_str)

    with httpx.Client(follow_redirects=True, timeout=30) as client:
        resp = client.get(url, headers=_HEADERS, cookies=cookies)

    logger.info("CSV response: status=%d, len=%d", resp.status_code, len(resp.text))

    if resp.status_code != 200:
        logger.warning("CSV download returned status %d", resp.status_code)
        return None

    content = resp.text
    # If we got redirected to a login page, cookies have expired
    if "ap_email" in content or "signin" in resp.url.path.lower():
        logger.warning("Redirected to login — cookies expired. Re-run extract_amazon_cookies.py")
        return None

    if len(content) < 20 or "Date" not in content:
        logger.warning("CSV response looks empty or invalid (len=%d)", len(content))
        return None

    return content


def _parse_csv(csv_content: str) -> Optional[dict]:
    """
    Parse Amazon Associates earnings CSV into { clicks, orders, revenue, commission }.

    Amazon CSV columns:
      Date, Clicks, Ordered Items, Shipped Items, Returns,
      Revenue, Converted Clicks, Total Commissions
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

            clicks = _num(["Clicks", "clicks"])
            orders = _num(["Shipped Items", "shipped_items", "Ordered Items", "ordered_items"])
            commission = _num(
                ["Total Commissions", "total_commissions", "Revenue", "revenue"],
                is_float=True,
            )

            total_clicks += clicks
            total_orders += orders
            total_commission += commission
            rows_read += 1

        if rows_read == 0:
            logger.warning("CSV parsed 0 data rows")
            return None

        logger.info(
            "Parsed %d CSV rows: clicks=%d, orders=%d, commission=%.2f",
            rows_read, total_clicks, total_orders, total_commission,
        )
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
    Syncs Amazon Associates earnings for all configured creators.
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
        cookie_str = os.environ.get(creator["cookies_env"])

        if not cookie_str:
            logger.warning("No cookies for %s (%s) — skipping", creator_id, creator["cookies_env"])
            results.append({"creator": creator_id, "status": "skipped", "reason": "no cookies"})
            continue

        logger.info("=== Syncing Amazon for %s ===", creator_id)
        try:
            csv_content = _download_csv(cookie_str, start_str, end_str)
            if not csv_content:
                results.append({"creator": creator_id, "status": "no_data"})
                continue

            earnings = _parse_csv(csv_content)
            if earnings:
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
                logger.info("Upserted Amazon earnings for %s: %s", creator_id, earnings)
            else:
                logger.warning("No earnings data for %s", creator_id)
                results.append({"creator": creator_id, "status": "no_data"})

        except Exception as e:
            logger.error("Amazon sync failed for %s: %s", creator_id, e, exc_info=True)
            results.append({"creator": creator_id, "status": "error", "error": str(e)})

    return {"synced": synced_at.isoformat(), "results": results}
