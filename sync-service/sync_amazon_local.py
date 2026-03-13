#!/usr/bin/env python3
"""
Local Mac cron script — runs on Ethan's Mac (residential IP) to sync Amazon Associates.

Scheduled via launchctl to run daily. Logs into Associates Central, downloads CSV,
POSTs results to the Railway sync service which writes to the database.

First-time setup (one-time, headful, manual 2FA):
  python3 sync_amazon_local.py --setup

Daily cron (headless, reuses saved browser state):
  python3 sync_amazon_local.py

Setup:
  launchctl load ~/Library/LaunchAgents/com.entagen.amazon-sync.plist

Requires in Doppler (ent-agency-automation/dev):
  AMAZON_NICKI_EMAIL / LTK_EMAIL (fallback)
  AMAZON_NICKI_PASSWORD
  SYNC_RAILWAY_SECRET   (Bearer token for Railway sync service)
"""
import argparse
import csv
import io
import json
import logging
import os
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import httpx
import pyotp
from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

RAILWAY_URL = "https://exemplary-analysis-production.up.railway.app"
STATE_DIR = Path.home() / ".entagen"
STATE_DIR.mkdir(exist_ok=True)

CREATORS = [
    {
        "id": "nicki_entenmann",
        "email_env": "AMAZON_NICKI_EMAIL",
        "email_env_fallback": "LTK_EMAIL",
        "password_env": "AMAZON_NICKI_PASSWORD",
        "totp_env": "AMAZON_NICKI_TOTP_SECRET",
        "state_file": STATE_DIR / "amazon-nicki-state.json",
    },
]

_SIGNIN_URL = (
    "https://www.amazon.com/ap/signin"
    "?openid.pape.max_auth_age=0"
    "&openid.return_to=https%3A%2F%2Faffiliate-program.amazon.com%2Fhome"
    "&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select"
    "&openid.assoc_handle=amzn_associates_us"
    "&openid.mode=checkid_setup"
    "&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select"
    "&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0"
)


def _get_env(primary, fallback=None):
    val = os.environ.get(primary) if primary else None
    if not val and fallback:
        val = os.environ.get(fallback)
    return val or None


def _login_headful(page, email, password):
    """Full login with visible browser — user handles 2FA manually."""
    logger.info("Navigating to Amazon signin (headful)...")
    page.goto(_SIGNIN_URL, wait_until="domcontentloaded", timeout=30000)

    try:
        page.wait_for_selector("#ap_email", timeout=15000)
        page.fill("#ap_email", email)
        page.click("#continue")
    except Exception as e:
        logger.error("Email step failed: %s", e)
        return False

    try:
        page.wait_for_selector("#ap_password", timeout=15000)
        page.fill("#ap_password", password)
        page.click("#signInSubmit")
    except Exception as e:
        logger.error("Password step failed: %s", e)
        return False

    print("\n" + "="*60, flush=True)
    print("Browser is open. If prompted for 2FA:", flush=True)
    print("  1. Enter the SMS/authenticator code", flush=True)
    print("  2. Check 'Don't require OTP on this browser'", flush=True)
    print("  3. Click Sign In", flush=True)
    print("\nWaiting up to 5 minutes for you to complete login...", flush=True)
    print("="*60 + "\n", flush=True)

    # Wait up to 5 minutes for the user to complete 2FA manually
    deadline = time.time() + 300
    while time.time() < deadline:
        time.sleep(3)
        try:
            url = page.url
            print(f"  waiting... url={url[:80]}", flush=True)
            if "affiliate-program.amazon.com" in url and "ap/signin" not in url and "www.amazon.com" not in url:
                logger.info("Login complete: %s", url[:80])
                return True
        except Exception:
            pass

    logger.error("Timed out waiting for manual login")
    return False


def _login_headless(page, email, password, totp_secret=None):
    """Headless login with TOTP support."""
    logger.info("Navigating to Associates Central (headless)...")
    page.goto("https://affiliate-program.amazon.com/home", wait_until="domcontentloaded", timeout=30000)
    time.sleep(2)
    url = page.url
    logger.info("URL after navigation: %s", url[:80])
    if "affiliate-program.amazon.com" in url and "ap/signin" not in url and "www.amazon.com" not in url:
        logger.info("Session still valid — already logged in")
        return True

    logger.info("Session expired, doing full login...")
    try:
        page.goto(_SIGNIN_URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector("#ap_email", timeout=15000)
        page.fill("#ap_email", email)
        page.click("#continue")
        page.wait_for_selector("#ap_password", timeout=15000)
        page.fill("#ap_password", password)
        page.click("#signInSubmit")
        page.wait_for_load_state("networkidle", timeout=30000)
    except Exception as e:
        logger.error("Login step failed: %s", e)
        return False

    url = page.url
    logger.info("After password: %s", url[:80])

    # Handle 2FA
    if totp_secret and any(x in url for x in ["ap/mfa", "ap/cvf", "challenge", "mfa"]):
        try:
            # Log page text to understand what options Amazon is showing
            page_text = page.evaluate("() => document.body.innerText")
            logger.info("2FA page text: %s", page_text[:400])

            # If Amazon defaulted to SMS, try to switch to authenticator app
            # Look for links like "Use a different device", "Having trouble?", etc.
            switched = False
            for link_text in ["authenticator app", "different verification", "different method", "different device", "Having trouble"]:
                try:
                    page.get_by_text(link_text, exact=False).first.click(timeout=2000)
                    page.wait_for_load_state("domcontentloaded", timeout=10000)
                    logger.info("Switched 2FA method via '%s'", link_text)
                    switched = True
                    break
                except Exception:
                    pass

            if switched:
                page_text = page.evaluate("() => document.body.innerText")
                logger.info("After switch: %s", page_text[:300])

            otp_field = "input[name='otpCode'], #auth-mfa-otpcode, input[name='code'], input[autocomplete='one-time-code'], input[type='tel']"
            page.wait_for_selector(otp_field, timeout=10000)
            otp = pyotp.TOTP(totp_secret).now()
            logger.info("Submitting TOTP: %s", otp)
            page.fill(otp_field, otp)
            # Check "don't require on this browser" if available
            try:
                page.check("input[name='rememberDevice'], #auth-mfa-remember-device", timeout=2000)
            except Exception:
                pass
            page.click("#auth-signin-button, input[type='submit'], button[type='submit']")
            page.wait_for_load_state("networkidle", timeout=30000)
            url = page.url
            logger.info("After TOTP: %s", url[:80])
        except Exception as e:
            logger.error("TOTP step failed: %s", e)
            return False

    if "affiliate-program.amazon.com" in url and "ap/signin" not in url and "www.amazon.com" not in url:
        return True

    logger.error("Login failed after all steps. url=%s", url[:80])
    return False


def _download_csv(page, start_date, end_date):
    """Download earnings CSV. Tries multiple URL patterns."""
    for download_url in [
        (
            "https://affiliate-program.amazon.com/home/reports/download"
            f"?reportType=earning&dateRangeValue=custom"
            f"&startDate={start_date}&endDate={end_date}"
        ),
        (
            "https://affiliate-program.amazon.com/reporting/download"
            f"?reportType=earning&dateRangeValue=custom"
            f"&startDate={start_date}&endDate={end_date}"
        ),
    ]:
        logger.info("Trying CSV URL: %s", download_url)
        try:
            page.goto(download_url, wait_until="domcontentloaded", timeout=30000)
            time.sleep(2)
            cur = page.url
            if "affiliate-program.amazon.com" in cur and "signin" not in cur:
                content = page.evaluate("() => document.body.innerText") or ""
                if len(content) > 50 and "Date" in content:
                    logger.info("CSV downloaded (len=%d)", len(content))
                    return content
                logger.info("URL worked but content invalid (len=%d) — trying next", len(content))
        except Exception as e:
            logger.warning("CSV URL failed: %s", e)

    # Fallback: intercept download from the reports page
    logger.info("Trying download intercept via reports page...")
    try:
        page.goto("https://affiliate-program.amazon.com/home/reports", wait_until="domcontentloaded", timeout=30000)
        time.sleep(2)
        if "signin" in page.url:
            logger.error("Redirected to signin on reports page")
            return None
        with page.expect_download(timeout=30000) as dl:
            page.evaluate(
                f"""() => {{
                    const a = document.createElement('a');
                    a.href = '/home/reports/download?reportType=earning&dateRangeValue=custom'
                           + '&startDate={start_date}&endDate={end_date}';
                    document.body.appendChild(a);
                    a.click();
                }}"""
            )
        path = dl.value.path()
        if path:
            with open(path) as f:
                text = f.read()
            if len(text) > 50 and "Date" in text:
                logger.info("CSV via download intercept (len=%d)", len(text))
                return text
    except Exception as e:
        logger.warning("Download intercept failed: %s", e)

    logger.error("All CSV download strategies failed")
    return None


def _parse_csv(csv_content):
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

            total_clicks += _num(["Clicks"])
            total_orders += _num(["Shipped Items", "Ordered Items"])
            total_commission += _num(["Total Commissions", "Revenue"], is_float=True)
            rows_read += 1

        if rows_read == 0:
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


def get_date_range(args) -> tuple:
    """Return (period_start, period_end). Defaults to current calendar month."""
    today = date.today()
    if getattr(args, 'start_date', None) and getattr(args, 'end_date', None):
        return date.fromisoformat(args.start_date), date.fromisoformat(args.end_date)
    # Default: current calendar month
    period_start = date(today.year, today.month, 1)
    if today.month < 12:
        period_end = date(today.year, today.month + 1, 1) - timedelta(days=1)
    else:
        period_end = date(today.year, 12, 31)
    return period_start, period_end


def main():
    parser = argparse.ArgumentParser(description="Sync Amazon Associates earnings locally.")
    parser.add_argument("--setup", action="store_true", help="Run headful login to save browser state (one-time, handles manual 2FA)")
    parser.add_argument("--start-date", default=None, help="YYYY-MM-DD start date (default: first day of current month)")
    parser.add_argument("--end-date", default=None, help="YYYY-MM-DD end date (default: last day of current month)")
    args = parser.parse_args()

    setup_mode = args.setup

    # Load secrets from Doppler
    result = subprocess.run(
        ["doppler", "secrets", "download", "--no-file", "--format", "json",
         "--project", "ent-agency-automation", "--config", "dev"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        logger.error("Doppler failed: %s", result.stderr)
        sys.exit(1)
    secrets = json.loads(result.stdout)
    for k, v in secrets.items():
        os.environ.setdefault(k, v)

    sync_secret = os.environ.get("SYNC_RAILWAY_SECRET", "")
    if not sync_secret:
        logger.error("SYNC_RAILWAY_SECRET not set")
        sys.exit(1)

    period_start, period_end = get_date_range(args)

    all_results = []

    with sync_playwright() as p:
        for creator in CREATORS:
            creator_id = creator["id"]
            email = _get_env(creator["email_env"], creator.get("email_env_fallback"))
            password = _get_env(creator["password_env"])
            totp_secret = _get_env(creator.get("totp_env"))
            state_file = str(creator["state_file"])

            if not email or not password:
                logger.warning("No credentials for %s", creator_id)
                continue

            logger.info("=== Syncing %s (setup=%s) ===", creator_id, setup_mode)

            # Load existing state if available
            storage_state = state_file if Path(state_file).exists() else None
            if storage_state:
                logger.info("Loading saved browser state from %s", state_file)
            else:
                logger.info("No saved state found — fresh browser session")

            browser = p.chromium.launch(
                headless=not setup_mode,
                args=[
                    "--no-sandbox", "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled",
                ],
            )
            context = browser.new_context(
                storage_state=storage_state,
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1280, "height": 800},
                locale="en-US",
            )
            page = context.new_page()
            Stealth().apply_stealth_sync(page)

            try:
                if setup_mode:
                    logged_in = _login_headful(page, email, password)
                else:
                    logged_in = _login_headless(page, email, password, totp_secret)

                if not logged_in:
                    logger.error("Login failed for %s", creator_id)
                    browser.close()
                    continue

                # Save browser state so next run skips 2FA
                context.storage_state(path=state_file)
                logger.info("Browser state saved to %s", state_file)

                csv_content = _download_csv(page, period_start.isoformat(), period_end.isoformat())
                if not csv_content:
                    logger.warning("No CSV for %s", creator_id)
                    browser.close()
                    continue

                earnings = _parse_csv(csv_content)
                if not earnings:
                    logger.warning("CSV parse returned nothing for %s", creator_id)
                    browser.close()
                    continue

                logger.info("Earnings for %s: %s", creator_id, earnings)
                all_results.append({
                    "creator_id": creator_id,
                    "period_start": period_start.isoformat(),
                    "period_end": period_end.isoformat(),
                    **earnings,
                })

            except Exception as e:
                logger.error("Sync error for %s: %s", creator_id, e, exc_info=True)
            finally:
                context.close()
                browser.close()

    if not all_results:
        logger.warning("No results to push")
        return

    # Push to Railway sync service
    resp = httpx.post(
        f"{RAILWAY_URL}/sync/amazon-push",
        json={"results": all_results},
        headers={"Authorization": f"Bearer {sync_secret}"},
        timeout=30,
    )
    logger.info("Railway push: %d — %s", resp.status_code, resp.text[:200])


if __name__ == "__main__":
    main()
