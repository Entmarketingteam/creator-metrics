"""
ShopMy affiliate sync — session-based auth + payout/payment/brand-rate sync to Supabase.

Auth flow:
  1. POST /api/Auth/session with email + password → session cookies + CSRF token
  2. Use cookies + x-csrf-token for all subsequent API calls
  3. Sessions are short-lived — re-authenticate on each sync run

Data synced:
  - Payout summary (monthly totals) → platform_earnings
  - Individual commissions (payouts) → sales
  - Completed payments → shopmy_payments
  - Brand commission rates → shopmy_brand_rates

Credentials per creator: SHOPMY_{CREATOR}_EMAIL / SHOPMY_{CREATOR}_PASSWORD in Doppler/env.
Creator must have shopmy_user_id set in the creators table.
"""
import calendar
import json
import logging
import os
from datetime import date, datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

SHOPMY_API_BASE = "https://apiv3.shopmy.us"
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

# Add creators here as ShopMy credentials become available.
# creator_id: must match the id in the creators table
# shopmy_user_id: ShopMy internal user ID (stored in creators.shopmy_user_id)
# env_prefix: Doppler env var prefix for email/password
SHOPMY_CREATORS = [
    {
        "creator_id": "nicki_entenmann",
        "env_prefix": "SHOPMY_NICKI",
    },
    # Add more creators here once credentials are in Doppler:
    # {
    #     "creator_id": "sara_preston",
    #     "env_prefix": "SHOPMY_SARA",
    # },
    # {
    #     "creator_id": "ellen_ludwig",
    #     "env_prefix": "SHOPMY_ELLEN",
    # },
]


# ── ShopMy API helpers ─────────────────────────────────────────────────────────

def _login_shopmy(email: str, password: str) -> dict:
    """
    Authenticate with ShopMy and return session dict with cookie_header and csrf_token.
    """
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{SHOPMY_API_BASE}/api/Auth/session",
            json={"username": email, "password": password},
            headers={
                "Content-Type": "application/json",
                "User-Agent": BROWSER_UA,
                "Accept": "application/json, text/plain, */*",
                "x-apicache-bypass": "true",
                "x-session-id": str(int(datetime.now(timezone.utc).timestamp() * 1000)),
                "Origin": "https://shopmy.us",
                "Referer": "https://shopmy.us/",
            },
        )
        resp.raise_for_status()

    # Extract cookies from Set-Cookie headers
    cookies = resp.cookies
    all_cookies = []
    csrf_token = None

    # httpx cookies jar
    for name, value in cookies.items():
        all_cookies.append(f"{name}={value}")
        if name == "shopmy_csrf_token":
            # The csrf token may be URL-encoded; extract the UUID
            import urllib.parse
            decoded = urllib.parse.unquote(value)
            import re
            uuid_match = re.search(
                r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                decoded,
                re.IGNORECASE,
            )
            csrf_token = uuid_match.group(0) if uuid_match else decoded

    # Also check raw Set-Cookie headers if httpx cookies didn't capture csrf
    if not csrf_token:
        raw_set_cookie = resp.headers.get_list("set-cookie") if hasattr(resp.headers, "get_list") else []
        if not raw_set_cookie:
            raw_sc = resp.headers.get("set-cookie", "")
            raw_set_cookie = [raw_sc] if raw_sc else []
        for sc in raw_set_cookie:
            if "shopmy_csrf_token=" in sc:
                import urllib.parse, re
                part = sc.split(";")[0].split("=", 1)[1]
                decoded = urllib.parse.unquote(part)
                uuid_match = re.search(
                    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                    decoded,
                    re.IGNORECASE,
                )
                csrf_token = uuid_match.group(0) if uuid_match else decoded
                break

    if not csrf_token:
        raise RuntimeError("ShopMy login: shopmy_csrf_token not found in response cookies")

    cookie_header = "; ".join(all_cookies)
    return {"cookie_header": cookie_header, "csrf_token": csrf_token}


def _shopmy_headers(session: dict) -> dict:
    """Build headers for authenticated ShopMy API requests."""
    return {
        "Accept": "application/json, text/plain, */*",
        "x-csrf-token": session["csrf_token"],
        "x-session-id": str(int(datetime.now(timezone.utc).timestamp() * 1000)),
        "x-apicache-bypass": "true",
        "User-Agent": BROWSER_UA,
        "Origin": "https://shopmy.us",
        "Referer": "https://shopmy.us/",
        "Cookie": session["cookie_header"],
    }


def _shopmy_get(session: dict, path: str) -> dict:
    """Make an authenticated GET request to the ShopMy API."""
    url = f"{SHOPMY_API_BASE}{path}"
    with httpx.Client(timeout=30) as client:
        resp = client.get(url, headers=_shopmy_headers(session))
        resp.raise_for_status()
        return resp.json()


def _fetch_payout_summary(session: dict, user_id: str) -> dict:
    """Fetch payout summary (monthly totals + individual commissions)."""
    result = _shopmy_get(session, f"/api/Payouts/payout_summary/{user_id}")
    # Unwrap { data: ... } envelope if present
    return result.get("data", result) if isinstance(result, dict) else result


def _fetch_payments(session: dict, user_id: str) -> list:
    """Fetch completed payment history."""
    result = _shopmy_get(session, f"/api/Payments/by_user/{user_id}")
    return result.get("payments", []) if isinstance(result, dict) else []


def _fetch_brand_rates(session: dict, user_id: str) -> list:
    """Fetch brand-specific commission rates."""
    result = _shopmy_get(session, f"/api/CustomRates/all_rates/{user_id}")
    if isinstance(result, list):
        return result
    return result.get("rates", []) if isinstance(result, dict) else []


def _parse_amount(value) -> str:
    """Parse a ShopMy dollar string like '$1,200.00' into a plain numeric string."""
    if value is None:
        return "0"
    return str(value).replace("$", "").replace(",", "") or "0"


def _map_status(commission: dict) -> str:
    """Map ShopMy commission status to our standard status enum."""
    if commission.get("isPaid"):
        return "paid"
    s = (commission.get("statusDisplay") or commission.get("status") or "").lower()
    if "paid" in s:
        return "paid"
    if "pending" in s or "processing" in s:
        return "pending"
    if "reversed" in s or "cancel" in s:
        return "reversed"
    return "open"


# ── Supabase helpers ───────────────────────────────────────────────────────────

def _get_shopmy_user_id(conn, creator_id: str) -> Optional[str]:
    """Look up shopmy_user_id from the creators table."""
    # asyncpg conn.execute returns status string, need fetchval/fetchrow
    # SyncConn wraps asyncpg — use conn._loop and conn._conn directly for fetch
    loop = conn._loop
    row = loop.run_until_complete(
        conn._conn.fetchval(
            "SELECT shopmy_user_id FROM creators WHERE id = $1",
            creator_id,
        )
    )
    return row


# ── Main sync function ─────────────────────────────────────────────────────────

def _sync_shopmy_creator(conn, creator: dict) -> dict:
    """Sync ShopMy data for a single creator."""
    creator_id = creator["creator_id"]
    env_prefix = creator["env_prefix"]

    email = os.environ.get(f"{env_prefix}_EMAIL")
    password = os.environ.get(f"{env_prefix}_PASSWORD")

    if not email or not password:
        logger.warning(
            "Skipping %s — missing ShopMy credentials (%s_EMAIL / %s_PASSWORD). "
            "Add to Doppler and redeploy.",
            creator_id, env_prefix, env_prefix,
        )
        return {"creator": creator_id, "status": "skipped", "reason": "no credentials"}

    # Look up shopmy_user_id from DB
    shopmy_user_id = _get_shopmy_user_id(conn, creator_id)
    if not shopmy_user_id:
        logger.warning(
            "Skipping %s — no shopmy_user_id in creators table. "
            "Set it via the admin panel or direct DB update.",
            creator_id,
        )
        return {"creator": creator_id, "status": "skipped", "reason": "no shopmy_user_id"}

    try:
        # Authenticate
        logger.info("[%s] Logging into ShopMy...", creator_id)
        session = _login_shopmy(email, password)
        logger.info("[%s] ShopMy login OK", creator_id)

        # Fetch all data in parallel-ish (sequential but fast)
        summary = _fetch_payout_summary(session, shopmy_user_id)
        payments = []
        brand_rates = []
        try:
            payments = _fetch_payments(session, shopmy_user_id)
        except Exception as e:
            logger.warning("[%s] ShopMy payments fetch failed: %s", creator_id, e)
        try:
            brand_rates = _fetch_brand_rates(session, shopmy_user_id)
        except Exception as e:
            logger.warning("[%s] ShopMy brand rates fetch failed: %s", creator_id, e)

        synced_at = datetime.now(timezone.utc)

        # --- Upsert individual commissions (payouts) → sales table ---
        payouts = summary.get("payouts", [])
        payout_count = 0
        for c in payouts:
            external_id = str(c.get("id") or c.get("order_id") or c.get("transaction_id") or "")
            if not external_id:
                continue

            sale_date_raw = c.get("transaction_date") or c.get("created_at")
            sale_date = datetime.fromisoformat(sale_date_raw.replace("Z", "+00:00")) if sale_date_raw else synced_at

            commission_amount = (
                str(c["amountEarned"]) if c.get("amountEarned") is not None
                else _parse_amount(c.get("commission_amount"))
            )

            conn.execute(
                """
                INSERT INTO sales
                    (creator_id, platform, sale_date, brand, commission_amount,
                     order_value, product_name, status, external_id)
                VALUES ($1, 'shopmy', $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT DO NOTHING
                """,
                creator_id,
                sale_date,
                c.get("merchant") or c.get("brand"),
                commission_amount,
                _parse_amount(c.get("order_amount")),
                c.get("title") or c.get("product_title") or c.get("productTitle") or c.get("name"),
                _map_status(c),
                external_id,
            )
            payout_count += 1

        # --- Upsert payments (completed payouts) → shopmy_payments ---
        payment_count = 0
        for p in payments:
            ext_id = p.get("id")
            if ext_id is None:
                continue

            sent_date = None
            if p.get("sent_date"):
                try:
                    sent_date = datetime.fromisoformat(
                        p["sent_date"].replace("Z", "+00:00")
                    )
                except (ValueError, AttributeError):
                    sent_date = None

            conn.execute(
                """
                INSERT INTO shopmy_payments
                    (creator_id, external_id, amount, source, sent_at, synced_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (external_id)
                DO UPDATE SET
                    amount = EXCLUDED.amount,
                    source = EXCLUDED.source,
                    sent_at = EXCLUDED.sent_at,
                    synced_at = EXCLUDED.synced_at
                """,
                creator_id,
                int(ext_id),
                str(p.get("amount", 0)),
                p.get("source", "PAYPAL"),
                sent_date,
                synced_at,
            )
            payment_count += 1

        # --- Upsert brand rates → shopmy_brand_rates ---
        rate_count = 0
        for br in brand_rates:
            brand_obj = br.get("brand")
            if isinstance(brand_obj, dict):
                brand_name = brand_obj.get("name") or brand_obj.get("brand_name")
            else:
                brand_name = brand_obj
            if not brand_name:
                continue

            rate_val = str(br["rate"]) if br.get("rate") is not None else None
            rate_ret_val = str(br["rate_returning"]) if br.get("rate_returning") is not None else None

            conn.execute(
                """
                INSERT INTO shopmy_brand_rates
                    (creator_id, brand, rate, rate_returning, synced_at)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (creator_id, brand)
                DO UPDATE SET
                    rate = EXCLUDED.rate,
                    rate_returning = EXCLUDED.rate_returning,
                    synced_at = EXCLUDED.synced_at
                """,
                creator_id,
                brand_name,
                rate_val,
                rate_ret_val,
                synced_at,
            )
            rate_count += 1

        # --- Upsert monthly totals → platform_earnings ---
        # months keys: "M/D/YY" format (e.g. "2/28/26")
        months = summary.get("months", {})
        month_count = 0
        for month_key, month_data in months.items():
            try:
                parts = month_key.split("/")
                m, y = int(parts[0]), int(parts[2])
                full_year = 2000 + y
                # First day of month
                period_start = date(full_year, m, 1)
                # Last day of month
                last_day = calendar.monthrange(full_year, m)[1]
                period_end = date(full_year, m, last_day)
            except (ValueError, IndexError):
                logger.warning("[%s] Could not parse month key: %s", creator_id, month_key)
                continue

            total = month_data.get("user_payout_total", 0)

            conn.execute(
                """
                INSERT INTO platform_earnings
                    (creator_id, platform, period_start, period_end,
                     revenue, commission, raw_payload, synced_at)
                VALUES ($1, 'shopmy', $2, $3, $4, $5, $6, $7)
                ON CONFLICT (creator_id, platform, period_start, period_end)
                DO UPDATE SET
                    revenue = EXCLUDED.revenue,
                    commission = EXCLUDED.commission,
                    raw_payload = EXCLUDED.raw_payload,
                    synced_at = EXCLUDED.synced_at
                """,
                creator_id,
                period_start,
                period_end,
                str(total),
                str(total),
                json.dumps(month_data),
                synced_at,
            )
            month_count += 1

        logger.info(
            "[%s] ShopMy sync OK: payouts=%d, payments=%d, brand_rates=%d, months=%d",
            creator_id, payout_count, payment_count, rate_count, month_count,
        )
        return {
            "creator": creator_id,
            "status": "ok",
            "payouts": payout_count,
            "payments": payment_count,
            "brand_rates": rate_count,
            "months": month_count,
        }

    except Exception as e:
        logger.error("[%s] ShopMy sync failed: %s", creator_id, e, exc_info=True)
        return {"creator": creator_id, "status": "error", "error": str(e)}


def sync_shopmy(conn) -> dict:
    """
    Main entry point — sync ShopMy data for all configured creators.
    Called by the Railway sync service (main.py).
    """
    results = []
    skipped = []

    for creator in SHOPMY_CREATORS:
        result = _sync_shopmy_creator(conn, creator)
        if result.get("status") == "skipped":
            skipped.append(result["creator"])
        else:
            results.append(result)

    logger.info("ShopMy sync complete: %d synced, %d skipped", len(results), len(skipped))
    return {
        "status": "ok",
        "synced": results,
        "skipped": skipped,
    }
