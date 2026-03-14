"""
Amazon Associates sync — Airtop browser login + Reporting API.

Auth flow (Airtop mode — AIRTOP_API_KEY set):
  1. Airtop opens a cloud browser on a residential IP
  2. Logs into Amazon Associates with email + password (+ TOTP if needed)
  3. Navigates to reporting page, extracts Bearer JWT + CSRF token from DOM
  4. Browser closes — tokens used for all subsequent API calls

Auth flow (Proxy mode — WEBSHARE_PROXY_URL set, no AIRTOP_API_KEY):
  1. Reads stored cookies/tokens from Doppler env vars
  2. Routes all Amazon API calls through Webshare residential proxy (bypasses WAF)
  3. Syncs last 6 months + 90 days of daily data
"""
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone

from amazon_auth import CREATORS, _save_to_doppler
from amazon_airtop import get_amazon_tokens
from amazon_reporting_api import fetch_earnings_with_tokens

logger = logging.getLogger(__name__)

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

TAGS = {
    "nicki_entenmann": "nickientenman-20",
    "annbschulte": "annschulte-20",
    "ellenludwigfitness": "ellenludwig-20",
    "livefitwithem": "livefitwithem-20",
}

CREATOR_ENV_PREFIX = {
    "nicki_entenmann": "NICKI",
    "annbschulte": "ANN",
    "ellenludwigfitness": "ELLEN",
    "livefitwithem": "EMILY",
}


# ── Webshare proxy mode helpers ───────────────────────────────────────────────

# 44,744 US backbone residential proxies available.
# Each uses username rpeolskt-US-{N}, port 10000+(N-1), host p.webshare.io.
# Rotate randomly on each sync run to distribute load and avoid pattern detection.
_WEBSHARE_US_PROXY_COUNT = 44744
_WEBSHARE_HOST = "p.webshare.io"
_WEBSHARE_BASE_PORT = 10000


def _get_rotating_proxy_url() -> str:
    """
    Build a random US residential backbone proxy URL.
    Uses WEBSHARE_PROXY_PASS from env (same password for all backbone proxies).
    Falls back to WEBSHARE_PROXY_URL if set directly.
    """
    import random
    direct = os.environ.get("WEBSHARE_PROXY_URL", "")
    if direct and "US" in direct:
        return direct  # Already a US proxy URL, use as-is

    password = os.environ.get("WEBSHARE_PROXY_PASS", "bilkz2iph8i7")
    n = random.randint(1, _WEBSHARE_US_PROXY_COUNT)
    port = _WEBSHARE_BASE_PORT + (n - 1)
    url = f"http://rpeolskt-US-{n}:{password}@{_WEBSHARE_HOST}:{port}"
    logger.info("Rotating proxy: rpeolskt-US-%d @ %s:%d", n, _WEBSHARE_HOST, port)
    return url


def _build_opener_proxy(proxy_url: str) -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
    )


def _build_headers_proxy(cookies, csrf, bearer, customer, marketplace, tag) -> dict:
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


def _fetch_monthly_proxy(opener, headers, tag, year, month):
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
        with opener.open(req, timeout=20) as resp:
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
            }
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:120]
        logger.warning("Monthly %s-%02d HTTP %d: %s", year, month, e.code, body)
        return None
    except Exception as e:
        logger.warning("Monthly %s-%02d error: %s", year, month, e)
        return None


def _fetch_daily_proxy(opener, headers, tag, start, end):
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
        with opener.open(req, timeout=25) as resp:
            data = json.loads(resp.read().decode())
            rows = data.get("records") or []
            for r in rows:
                if "commission_earnings" in r and "commission" not in r:
                    r["commission"] = r.pop("commission_earnings")
            return rows
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:120]
        logger.warning("Daily fetch HTTP %d: %s", e.code, body)
        return None
    except Exception as e:
        logger.warning("Daily fetch error: %s", e)
        return None


def _sync_amazon_proxy(conn) -> dict:
    """Sync Amazon earnings using stored credentials + Webshare residential proxy."""
    proxy_url = _get_rotating_proxy_url()
    masked = proxy_url.split("@")[-1] if "@" in proxy_url else proxy_url
    logger.info("Amazon proxy sync via %s", masked)

    opener = _build_opener_proxy(proxy_url)
    now = datetime.now(timezone.utc)
    synced_at = now
    months = int(os.environ.get("SYNC_MONTHS", "6"))
    days = int(os.environ.get("SYNC_DAYS", "90"))
    results = []

    for creator in CREATORS:
        creator_id = creator["id"]
        env_key = CREATOR_ENV_PREFIX.get(creator_id, creator_id.upper())
        tag = TAGS.get(creator_id) or creator.get("tag")

        if not tag:
            logger.info("Skipping %s — no associate tag", creator_id)
            results.append({"creator": creator_id, "status": "skipped", "reason": "no tag"})
            continue

        cookies = os.environ.get(f"AMAZON_{env_key}_COOKIES", "")
        if not cookies:
            logger.warning("[%s] No stored cookies — run capture-amazon-request.py first", creator_id)
            results.append({"creator": creator_id, "status": "skipped", "reason": "no cookies"})
            continue

        csrf = os.environ.get(f"AMAZON_{env_key}_CSRF_TOKEN", "")
        bearer = os.environ.get(f"AMAZON_{env_key}_BEARER_TOKEN", "")
        customer = os.environ.get(f"AMAZON_{env_key}_CUSTOMER_ID", "")
        marketplace = os.environ.get(f"AMAZON_{env_key}_MARKETPLACE_ID", "") or "ATVPDKIKX0DER"

        headers = _build_headers_proxy(cookies, csrf, bearer, customer, marketplace, tag)

        # Monthly
        periods = []
        y, m = now.year, now.month
        for _ in range(months):
            periods.append((y, m))
            m -= 1
            if m == 0:
                m, y = 12, y - 1

        logger.info("[%s] Syncing %d months via proxy...", creator_id, len(periods))
        monthly_ok = 0
        for year, month in sorted(periods):
            row = _fetch_monthly_proxy(opener, headers, tag, year, month)
            if row is None:
                continue
            try:
                conn.execute(
                    """
                    INSERT INTO platform_earnings
                        (creator_id, platform, period_start, period_end,
                         revenue, commission, clicks, orders, synced_at)
                    VALUES ($1, 'amazon', $2::date, $3::date, $4, $5, $6, $7, $8)
                    ON CONFLICT (creator_id, platform, period_start, period_end)
                    DO UPDATE SET
                        revenue = EXCLUDED.revenue, commission = EXCLUDED.commission,
                        clicks = EXCLUDED.clicks, orders = EXCLUDED.orders,
                        synced_at = EXCLUDED.synced_at
                    """,
                    creator_id, row["period_start"], row["period_end"],
                    row["revenue"], row["commission"], row["clicks"], row["orders"], synced_at,
                )
                monthly_ok += 1
            except Exception as e:
                logger.error("[%s] DB monthly write error: %s", creator_id, e)

        # Daily
        day_end = now.date()
        day_start = day_end - timedelta(days=days - 1)
        logger.info("[%s] Fetching daily (%s → %s)...", creator_id, day_start, day_end)
        daily_rows = _fetch_daily_proxy(opener, headers, tag, str(day_start), str(day_end))
        daily_ok = 0
        if daily_rows:
            for r in daily_rows:
                day_val = r.get("day") or r.get("date")
                if not day_val:
                    continue
                try:
                    conn.execute(
                        """
                        INSERT INTO amazon_daily_earnings
                            (creator_id, day, clicks, ordered_items, shipped_items,
                             revenue, commission, synced_at)
                        VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT (creator_id, day) DO UPDATE SET
                            clicks = EXCLUDED.clicks, ordered_items = EXCLUDED.ordered_items,
                            shipped_items = EXCLUDED.shipped_items,
                            revenue = EXCLUDED.revenue, commission = EXCLUDED.commission,
                            synced_at = EXCLUDED.synced_at
                        """,
                        creator_id, day_val,
                        int(r.get("clicks") or 0),
                        int(r.get("ordered_items") or 0),
                        int(r.get("shipped_items") or 0),
                        str(round(float(r.get("revenue") or 0), 2)),
                        str(round(float(r.get("commission") or 0), 2)),
                        synced_at,
                    )
                    daily_ok += 1
                except Exception as e:
                    logger.error("[%s] DB daily write error for %s: %s", creator_id, day_val, e)

        logger.info("[%s] OK monthly=%d daily=%d", creator_id, monthly_ok, daily_ok)
        results.append({"creator": creator_id, "status": "ok",
                        "monthly": monthly_ok, "daily": daily_ok})

    return {"synced": synced_at.isoformat(), "mode": "proxy", "results": results}


def sync_amazon(conn) -> dict:
    """Main entry point. Called by Railway sync service.

    Mode selection (checked in order):
      1. AIRTOP_API_KEY set  → Airtop cloud browser login (full headless)
      2. WEBSHARE_PROXY_URL set → Residential proxy + stored Doppler credentials
    """
    if not os.environ.get("AIRTOP_API_KEY") and (
        os.environ.get("WEBSHARE_PROXY_URL") or os.environ.get("WEBSHARE_PROXY_PASS")
    ):
        logger.info("No AIRTOP_API_KEY — using Webshare backbone proxy mode (rotating US IPs)")
        return _sync_amazon_proxy(conn)

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
