"""
Amazon Associates sync — logs into affiliate-program.amazon.com using
stored credentials + TOTP 2FA, downloads the earnings CSV, and writes
results to platform_earnings.

No Airtop/CDP needed — runs local Playwright (Chromium installed in Docker).

Doppler secrets per creator:
  AMAZON_{ID}_EMAIL         e.g. AMAZON_NICKI_EMAIL
  AMAZON_{ID}_PASSWORD      e.g. AMAZON_NICKI_PASSWORD
  AMAZON_{ID}_TOTP_SECRET   e.g. AMAZON_NICKI_TOTP_SECRET  (base32 seed, optional)

For Nicki specifically, EMAIL/PASSWORD are shared with LTK so we also
accept LTK_EMAIL / LTK_PASSWORD as fallback env var names.
"""
import csv
import io
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

CREATORS = [
    {
        "id": "nicki_entenmann",
        "email_env": "AMAZON_NICKI_EMAIL",
        "email_env_fallback": "LTK_EMAIL",
        "password_env": "AMAZON_NICKI_PASSWORD",
        "password_env_fallback": "LTK_PASSWORD",
        "totp_env": "AMAZON_NICKI_TOTP_SECRET",
        "tag": "nickientenmann-20",
    },
    {
        "id": "annbschulte",
        "email_env": "ANN_AMAZON_EMAIL",
        "email_env_fallback": None,
        "password_env": "ANN_AMAZON_PASSWORD",
        "password_env_fallback": None,
        "totp_env": "ANN_AMAZON_TOTP_SECRET",
        "tag": None,
    },
    {
        "id": "ellenludwigfitness",
        "email_env": "ELLEN_AMAZON_EMAIL",
        "email_env_fallback": None,
        "password_env": "ELLEN_AMAZON_PASSWORD",
        "password_env_fallback": None,
        "totp_env": "ELLEN_AMAZON_TOTP_SECRET",
        "tag": None,
    },
    {
        "id": "livefitwithem",
        "email_env": "EMILY_AMAZON_EMAIL",
        "email_env_fallback": None,
        "password_env": "EMILY_AMAZON_PASSWORD",
        "password_env_fallback": None,
        "totp_env": "EMILY_AMAZON_TOTP_SECRET",
        "tag": None,
    },
]

# Amazon signin URL — return_to sends us back to Associates Central after login
_SIGNIN_URL = (
    "https://www.amazon.com/ap/signin"
    "?openid.pape.max_auth_age=0"
    "&openid.return_to=https%3A%2F%2Faffiliate-program.amazon.com%2Fhome%2Fsummary"
    "&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select"
    "&openid.assoc_handle=usflex"
    "&openid.mode=checkid_setup"
    "&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select"
    "&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0"
)


def _get_env(primary: Optional[str], fallback: Optional[str] = None) -> Optional[str]:
    val = os.environ.get(primary) if primary else None
    if not val and fallback:
        val = os.environ.get(fallback)
    return val or None


def _login(page, email: str, password: str, totp_secret: Optional[str]) -> bool:
    """
    Complete the Amazon login flow. Returns True if we end up on Associates
    Central, False if we couldn't authenticate.
    """
    import pyotp

    logger.info("Navigating to Amazon signin...")
    page.goto(_SIGNIN_URL, wait_until="domcontentloaded", timeout=30000)

    # ── Email step ────────────────────────────────────────────────────────────
    try:
        page.wait_for_selector("#ap_email", timeout=15000)
        page.fill("#ap_email", email)
        page.click("#continue")
        logger.info("Email submitted")
    except Exception as e:
        logger.error("Email step failed: %s (url=%s)", e, page.url[:80])
        return False

    # ── Password step ─────────────────────────────────────────────────────────
    try:
        page.wait_for_selector("#ap_password", timeout=15000)
        page.fill("#ap_password", password)
        page.click("#signInSubmit")
        page.wait_for_load_state("networkidle", timeout=30000)
        logger.info("Password submitted — url=%s", page.url[:80])
    except Exception as e:
        logger.error("Password step failed: %s (url=%s)", e, page.url[:80])
        return False

    # ── 2FA / OTP step (if required) ─────────────────────────────────────────
    cur_url = page.url
    on_mfa = any(x in cur_url for x in ["ap/cvf", "auth/mfa", "ap/signin", "challenge"])

    if on_mfa:
        logger.info("2FA page detected: %s", cur_url[:80])

        if not totp_secret:
            logger.warning("2FA required but no TOTP secret configured — cannot proceed")
            return False

        try:
            # Amazon uses different selectors depending on 2FA type
            otp_selector = (
                "input[name='otpCode'], "
                "#auth-mfa-otpcode, "
                "input[name='code'], "
                "input[autocomplete='one-time-code']"
            )
            page.wait_for_selector(otp_selector, timeout=15000)
            otp_code = pyotp.TOTP(totp_secret).now()
            logger.info("Generated TOTP code")
            page.fill(otp_selector, otp_code)

            # Find and click the submit button
            submit_selector = (
                "#auth-signin-button, "
                "input[id='continue'], "
                "input[type='submit'], "
                "button[type='submit']"
            )
            page.click(submit_selector)
            page.wait_for_load_state("networkidle", timeout=30000)
            logger.info("2FA submitted — url=%s", page.url[:80])
        except Exception as e:
            logger.error("2FA step failed: %s", e)
            return False

    # ── Verify we're on Associates Central ────────────────────────────────────
    final_url = page.url
    if "affiliate-program.amazon.com" in final_url:
        logger.info("Successfully authenticated — on Associates Central")
        return True

    # Might need one more navigation if we landed on a landing page
    logger.info("Post-login URL: %s — navigating to Associates Central", final_url[:80])
    page.goto("https://affiliate-program.amazon.com/home/summary",
               wait_until="networkidle", timeout=30000)

    if "affiliate-program.amazon.com" in page.url:
        logger.info("On Associates Central after manual navigation")
        return True

    logger.error("Authentication failed — ended up at: %s", page.url[:80])
    return False


def _download_csv(page, start_date: str, end_date: str) -> Optional[str]:
    """
    Download the earnings CSV from Associates Central.
    Returns raw CSV text or None if download failed.
    """
    csv_url = (
        "https://affiliate-program.amazon.com/home/reports/download"
        f"?reportType=earning&dateRangeValue=custom"
        f"&startDate={start_date}&endDate={end_date}"
    )
    logger.info("Downloading earnings CSV: %s", csv_url)
    page.goto(csv_url, wait_until="domcontentloaded", timeout=30000)
    time.sleep(3)

    content = page.evaluate("() => document.body.innerText") or ""
    logger.info("CSV response: %d chars", len(content))

    if len(content) < 20 or "Date" not in content:
        # Might have been redirected to login — check URL
        logger.warning("CSV download failed or empty (url=%s, len=%d)", page.url[:80], len(content))
        return None

    return content


def _parse_csv(csv_content: str) -> Optional[dict]:
    """
    Parse Amazon Associates earnings CSV into { clicks, orders, revenue, commission }.

    Amazon CSV columns (may vary slightly):
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
            # Skip header repeats and total rows
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
            # Use Shipped Items as orders (what actually earned commission)
            orders = _num(["Shipped Items", "shipped_items", "Ordered Items", "ordered_items"])
            commission = _num(["Total Commissions", "total_commissions", "Revenue", "revenue"],
                               is_float=True)

            total_clicks += clicks
            total_orders += orders
            total_commission += commission
            rows_read += 1

        if rows_read == 0:
            logger.warning("CSV parsed 0 data rows")
            return None

        logger.info("Parsed %d CSV rows: clicks=%d, orders=%d, commission=%.2f",
                    rows_read, total_clicks, total_orders, total_commission)
        return {
            "clicks": total_clicks,
            "orders": total_orders,
            "revenue": round(total_commission, 2),
            "commission": round(total_commission, 2),
            # For Amazon, commission IS the revenue (Total Commissions = what creator earns)
        }
    except Exception as e:
        logger.error("CSV parse error: %s", e)
        return None


def _scrape_creator(email: str, password: str, totp_secret: Optional[str],
                    start_date: str, end_date: str) -> Optional[dict]:
    """
    Full scrape flow: login → download CSV → parse.
    Uses local Playwright (Chromium installed in Docker).
    """
    from playwright.sync_api import sync_playwright

    from playwright_stealth import stealth_sync

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
            locale="en-US",
        )
        page = context.new_page()
        # Patch automation signals so Amazon doesn't detect headless Chromium
        stealth_sync(page)

        try:
            authenticated = _login(page, email, password, totp_secret)
            if not authenticated:
                return None

            csv_content = _download_csv(page, start_date, end_date)
            if not csv_content:
                return None

            return _parse_csv(csv_content)

        finally:
            context.close()
            browser.close()


def sync_amazon(conn) -> dict:
    """
    Main entry point. Called by Railway sync service.
    Syncs Amazon Associates earnings for all configured creators.
    """
    today = date.today()
    # Fixed calendar-month period — same UPSERT key every day in the same month
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
        email = _get_env(creator["email_env"], creator.get("email_env_fallback"))
        password = _get_env(creator["password_env"], creator.get("password_env_fallback"))
        totp_secret = _get_env(creator.get("totp_env"))

        if not email or not password:
            logger.warning("No credentials for %s — skipping", creator_id)
            results.append({"creator": creator_id, "status": "skipped", "reason": "no credentials"})
            continue

        logger.info("=== Syncing Amazon for %s (%s) ===", creator_id, email)
        try:
            earnings = _scrape_creator(email, password, totp_secret, start_str, end_str)

            if earnings:
                conn.execute("""
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
