#!/usr/bin/env python3
"""
Amazon Associates Cookie Refresh
=================================
Uses Patchright (stealth Playwright) + TOTP to log into Amazon Associates Central,
extract fresh session cookies, and store them back to Doppler.

Run this when cookies expire (typically every 7-14 days):
    python3 tools/amazon-cookie-refresh.py

Or for a specific creator:
    python3 tools/amazon-cookie-refresh.py --creator nicki
    python3 tools/amazon-cookie-refresh.py --creator ann
    python3 tools/amazon-cookie-refresh.py --creator ellen

Credentials read from Doppler (project: ent-agency-automation, config: dev):
    AMAZON_{CREATOR}_EMAIL
    AMAZON_{CREATOR}_PASSWORD
    AMAZON_{CREATOR}_TOTP_SECRET

Cookies stored to Doppler:
    AMAZON_{CREATOR}_COOKIES     (full Cookie header string)
    AMAZON_{CREATOR}_AT_MAIN     (persistent auth cookie)
    AMAZON_{CREATOR}_X_MAIN      (persistent auth cookie)
    AMAZON_{CREATOR}_SESSION_ID  (session ID)
"""

import argparse
import subprocess
import sys
import time
import json
import html as html_lib
import re
from pathlib import Path

try:
    import pyotp
except ImportError:
    sys.exit("ERROR: pyotp not installed. Run: pip3 install pyotp")

try:
    from patchright.sync_api import sync_playwright, TimeoutError as PWTimeout
except ImportError:
    sys.exit("ERROR: patchright not installed. Run: pip3 install patchright && patchright install chromium")


def get_secret(key: str, project: str = "ent-agency-automation") -> str:
    result = subprocess.run(
        ["doppler", "secrets", "get", key, "--project", project, "--config", "dev", "--plain"],
        capture_output=True, text=True
    )
    return result.stdout.strip()


def set_secret(key: str, value: str, project: str = "ent-agency-automation") -> None:
    subprocess.run(
        ["doppler", "secrets", "set", f"{key}={value}", "--project", project, "--config", "dev"],
        capture_output=True
    )
    print(f"  ✓ {key} updated ({len(value)} chars)")


def get_totp(secret: str) -> str:
    return pyotp.TOTP(secret).now()


def login_associates(creator: str, headless: bool = True, sms_code: str = "") -> dict:
    """
    Log into Amazon Associates Central and return fresh cookies.
    Returns dict with keys: cookies (str), at_main, x_main, session_id, ubid_main

    headless=True: fully automated (requires device already trusted)
    headless=True + sms_code="": pauses to ask for SMS code on stdin (setup mode)
    """
    # Load creator credentials.
    # Primary key pattern: AMAZON_{CREATOR}_EMAIL (e.g. AMAZON_NICKI_EMAIL)
    # Legacy fallback pattern: {CREATOR}_AMAZON_EMAIL (e.g. ANN_AMAZON_EMAIL)
    prefix = f"AMAZON_{creator.upper()}"
    email = get_secret(f"{prefix}_EMAIL")
    password = get_secret(f"{prefix}_PASSWORD")
    totp_secret = get_secret(f"{prefix}_TOTP_SECRET")

    if not email:
        # Try legacy pattern: ANN_AMAZON_EMAIL
        alt_prefix = f"{creator.upper()}_AMAZON"
        email = get_secret(f"{alt_prefix}_EMAIL")
        password = get_secret(f"{alt_prefix}_PASSWORD")
        totp_secret = get_secret(f"{alt_prefix}_TOTP_SECRET") or totp_secret

    if not email or not password:
        sys.exit(f"Missing credentials for {creator}. Check Doppler: {prefix}_EMAIL / {prefix}_PASSWORD (also tried {creator.upper()}_AMAZON_EMAIL)")

    print(f"\n[{creator}] Logging into Associates Central as {email}...")

    # Persistent context directory — stores trusted-device state between logins.
    # This suppresses Amazon OTP challenge once device is trusted.
    user_data_dir = Path.home() / ".cache" / "amazon-associates-session" / creator
    user_data_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(user_data_dir),
            headless=headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-default-browser-check",
            ],
            viewport={"width": 1440, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            timezone_id="America/Chicago",
        )

        page = context.new_page()

        try:
            # --- Step 1: Navigate directly to Associates sign-in ---
            print(f"  → Navigating to Associates Central...")
            page.goto("https://affiliate-program.amazon.com/home", wait_until="domcontentloaded", timeout=30000)
            time.sleep(2)

            current_url = page.url

            # Check if already logged in
            if "affiliate-program.amazon.com" in current_url and "signin" not in current_url and "ap/signin" not in current_url:
                print(f"  → Already logged in (persistent session reused)")
            else:
                print(f"  → Sign-in required, starting auth flow...")

                # If not on the sign-in page yet, click sign in
                if "ap/signin" not in current_url and "signin" not in current_url:
                    sign_in = page.query_selector('a[href*="signin"]') or \
                              page.query_selector('a[href*="ap/signin"]')
                    if sign_in:
                        sign_in.click()
                        page.wait_for_load_state("domcontentloaded", timeout=15000)
                        time.sleep(1)

                # --- Step 2: Email field ---
                try:
                    page.wait_for_selector('#ap_email', timeout=10000)
                    print(f"  → Filling email...")
                    page.fill('#ap_email', email)
                    time.sleep(0.5)
                    page.click('#continue')
                    page.wait_for_load_state("domcontentloaded", timeout=15000)
                    time.sleep(1.5)
                except PWTimeout:
                    print(f"  ⚠ Email field not found — may already be past email step")

                # --- Step 3: Password ---
                try:
                    page.wait_for_selector('#ap_password', timeout=8000)
                    print(f"  → Filling password...")
                    page.fill('#ap_password', password)
                    time.sleep(0.5)
                    page.click('#signInSubmit')
                    page.wait_for_load_state("domcontentloaded", timeout=20000)
                    time.sleep(2)
                except PWTimeout:
                    print(f"  ⚠ Password field not found — may be handling captcha or different flow")

                # --- Step 4: OTP / 2FA ---
                # If we landed on an MFA page, wait for it to fully load
                if "mfa" in page.url or "new-otp" in page.url:
                    page.wait_for_load_state("domcontentloaded", timeout=10000)
                    time.sleep(1.5)

                # --- Step 4a: Handle new-otp method-selection page ---
                # This page shows radio buttons (WhatsApp/Call) + "Send OTP" button.
                # We must click "Send OTP" to proceed to the actual code-entry page.
                if "new-otp" in page.url:
                    print(f"  → New-OTP page detected — selecting WhatsApp and clicking Send OTP...")
                    # WhatsApp radio is pre-selected; just click Send OTP
                    page.screenshot(path=str(Path.home() / "Desktop" / f"amazon-newotp-debug-{creator}.png"))
                    # Use locator text matching — more reliable than CSS :has-text
                    try:
                        page.locator("text=Send OTP").first.click(timeout=5000)
                        print(f"  → Clicked Send OTP (WhatsApp)")
                        page.wait_for_load_state("domcontentloaded", timeout=20000)
                        time.sleep(2)
                    except PWTimeout:
                        # Fallback: try any submit button
                        for sel in ['button[type="submit"]', 'input[type="submit"]', '#continue']:
                            btn = page.query_selector(sel)
                            if btn and btn.is_visible():
                                btn.click()
                                print(f"  → Clicked submit ({sel})")
                                page.wait_for_load_state("domcontentloaded", timeout=20000)
                                time.sleep(2)
                                break
                        else:
                            raise RuntimeError("Could not find Send OTP button on new-otp page")

                # --- Step 4b: Find OTP code input field ---
                otp_field = None
                for otp_selector in [
                    '#auth-mfa-otpcode',
                    'input[name="otpCode"]',
                    '#otp',
                    '[autocomplete="one-time-code"]',
                    'input[type="tel"]',
                    'input[name="code"]',
                    'input[inputmode="numeric"]',
                    'input[type="text"][maxlength="6"]',
                    'input[type="number"]',
                ]:
                    el = page.query_selector(otp_selector)
                    if el and el.is_visible():
                        otp_field = el
                        print(f"  → Found OTP field: {otp_selector}")
                        break

                # Last resort: find first visible non-radio input
                if not otp_field and ("mfa" in page.url):
                    for el in page.query_selector_all('input'):
                        try:
                            itype = el.get_attribute("type") or "text"
                            if itype not in ("radio", "checkbox", "hidden", "submit", "button") and el.is_visible():
                                otp_field = el
                                print(f"  → Found OTP field (visible non-radio fallback)")
                                break
                        except Exception:
                            pass

                if otp_field:
                    print(f"  → 2FA required (WhatsApp/call to number ending in 946)")

                    # SMS/WhatsApp path: use provided code or ask on stdin
                    if True:
                        if sms_code:
                            code = sms_code
                            print(f"  → Using provided code: {code}")
                        else:
                            print(f"\n  ╔══════════════════════════════════════════════╗")
                            print(f"  ║  Amazon sent an SMS code to ...946           ║")
                            print(f"  ║  Check Nicki's phone for the code.           ║")
                            print(f"  ╚══════════════════════════════════════════════╝")
                            code = input("  Enter SMS code: ").strip()

                        # Check "remember this device" before submitting
                        remember = page.query_selector('#auth-mfa-remember-device') or \
                                   page.query_selector('[name="rememberDevice"]')
                        if remember and not remember.is_checked():
                            print(f"  → Checking 'remember this device'...")
                            remember.check()
                            time.sleep(0.3)

                        otp_field.fill(code)
                        time.sleep(0.5)
                        for submit_sel in ['#auth-signin-button', 'input[name="mfaSubmit"]', 'input[type="submit"]']:
                            submit = page.query_selector(submit_sel)
                            if submit:
                                submit.click()
                                break
                        try:
                            page.wait_for_url(lambda url: "ap/mfa" not in url, timeout=20000)
                        except PWTimeout:
                            raise RuntimeError("SMS code was rejected or timed out.")
                        page.wait_for_load_state("domcontentloaded", timeout=10000)
                        time.sleep(1.5)

                # --- Step 6: Ensure we land on Associates Central ---
                current_url = page.url
                if "affiliate-program.amazon.com" not in current_url:
                    print(f"  → Navigating to Associates Central (from: {current_url[:70]})...")
                    page.goto("https://affiliate-program.amazon.com/home", wait_until="domcontentloaded", timeout=25000)
                    time.sleep(2)
                    # If we bounced back to sign-in again, the session wasn't accepted
                    if "ap/signin" in page.url or "ap/mfa" in page.url:
                        raise RuntimeError(
                            f"Login redirect loop — Amazon rejected the session.\n"
                            f"Current URL: {page.url}\n"
                            f"This may indicate bot detection. Try headless=False for manual login."
                        )

            # --- Extract cookies ---
            print(f"  → Extracting cookies...")
            all_cookies = context.cookies()

            # Build full cookie header string (for requests)
            cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in all_cookies
                                    if "amazon.com" in c.get("domain", "") or
                                       "affiliate-program.amazon.com" in c.get("domain", ""))

            # Extract individual key cookies
            cookie_map = {c["name"]: c["value"] for c in all_cookies}

            at_main = cookie_map.get("at-main", "")
            x_main = cookie_map.get("x-main", "")
            session_id = cookie_map.get("session-id", "")
            ubid_main = cookie_map.get("ubid-main", "")
            sess_at_main = cookie_map.get("sess-at-main", "")

            if not at_main or not session_id:
                # Take screenshot for debugging
                page.screenshot(path=str(Path.home() / "Desktop" / f"amazon-login-debug-{creator}.png"))
                raise RuntimeError(
                    f"Login may have failed — key cookies missing. "
                    f"Check ~/Desktop/amazon-login-debug-{creator}.png\n"
                    f"Current URL: {page.url}"
                )

            print(f"  ✓ Cookies extracted (session-id: {session_id})")

            # --- Extract Bearer token, CSRF, and context IDs from /home/reports ---
            print(f"  → Navigating to /home/reports to extract Bearer token...")
            page.goto("https://affiliate-program.amazon.com/home/reports", wait_until="domcontentloaded", timeout=30000)
            time.sleep(3)

            html = page.content()
            decoded = html_lib.unescape(html)

            # Bearer token (associateIdentityToken) — a JWE starting with "eyJ"
            bearer_token = ""
            m = re.search(r'"associateIdentityToken"\s*:\s*"(eyJ[^"]+)"', decoded)
            if m:
                bearer_token = m.group(1)
                print(f"  ✓ Bearer token extracted ({len(bearer_token)} chars)")
            else:
                print(f"  ⚠ Bearer token NOT found in /home/reports HTML")
                page.screenshot(path=str(Path.home() / "Desktop" / f"amazon-bearer-debug-{creator}.png"))

            # CSRF token — <meta name="csrf-token" content="...">
            csrf_token = ""
            m = re.search(r'<meta name="csrf-token" content="([^"]+)"', html)
            if m:
                csrf_token = m.group(1)
                print(f"  ✓ CSRF token extracted ({len(csrf_token)} chars)")
            else:
                print(f"  ⚠ CSRF token NOT found")

            # Customer ID and marketplace ID from page config
            customer_id = ""
            m = re.search(r'"customerId"\s*:\s*"([A-Z0-9]+)"', decoded)
            if m:
                customer_id = m.group(1)
                print(f"  ✓ Customer ID: {customer_id}")

            marketplace_id = ""
            m = re.search(r'"marketplaceId"\s*:\s*"([A-Z0-9]+)"', decoded)
            if m:
                marketplace_id = m.group(1)
                print(f"  ✓ Marketplace ID: {marketplace_id}")

            context.close()

            return {
                "cookies": cookie_str,
                "at_main": at_main,
                "x_main": x_main,
                "session_id": session_id,
                "ubid_main": ubid_main,
                "sess_at_main": sess_at_main,
                "bearer_token": bearer_token,
                "csrf_token": csrf_token,
                "customer_id": customer_id,
                "marketplace_id": marketplace_id,
            }

        except Exception as e:
            try:
                page.screenshot(path=str(Path.home() / "Desktop" / f"amazon-login-error-{creator}.png"))
            except Exception:
                pass
            context.close()
            raise e


def refresh_creator(creator: str, setup_mode: bool = False, sms_code: str = "") -> None:
    print(f"\n{'='*50}")
    print(f"Refreshing Amazon cookies for: {creator}")
    print(f"{'='*50}")

    result = login_associates(creator, headless=True, sms_code=sms_code)
    prefix = f"AMAZON_{creator.upper()}"

    print(f"\n  Storing to Doppler...")
    set_secret(f"{prefix}_COOKIES", result["cookies"])
    set_secret(f"{prefix}_AT_MAIN", result["at_main"])
    set_secret(f"{prefix}_X_MAIN", result["x_main"])
    set_secret(f"{prefix}_SESSION_ID", result["session_id"])
    set_secret(f"{prefix}_UBID_MAIN", result["ubid_main"])
    if result["sess_at_main"]:
        set_secret(f"{prefix}_SESS_AT_MAIN", result["sess_at_main"])
    if result["bearer_token"]:
        set_secret(f"{prefix}_BEARER_TOKEN", result["bearer_token"])
    if result["csrf_token"]:
        set_secret(f"{prefix}_CSRF_TOKEN", result["csrf_token"])
    if result["customer_id"]:
        set_secret(f"{prefix}_CUSTOMER_ID", result["customer_id"])
    if result["marketplace_id"]:
        set_secret(f"{prefix}_MARKETPLACE_ID", result["marketplace_id"])

    print(f"\n  ✅ {creator} cookies + bearer token refreshed and stored to Doppler")


def test_cookies(creator: str) -> bool:
    """Quick test: hit /reporting/summary to verify cookies + bearer token are valid."""
    import urllib.request
    import urllib.parse

    prefix = f"AMAZON_{creator.upper()}"
    cookies = get_secret(f"{prefix}_COOKIES")
    bearer_token = get_secret(f"{prefix}_BEARER_TOKEN")
    csrf_token = get_secret(f"{prefix}_CSRF_TOKEN")
    customer_id = get_secret(f"{prefix}_CUSTOMER_ID")
    marketplace_id = get_secret(f"{prefix}_MARKETPLACE_ID") or "ATVPDKIKX0DER"
    tag = f"{creator}entenman-20"

    params = urllib.parse.urlencode({
        "query[start_date]": "2026-03-01",
        "query[end_date]": "2026-03-10",
        "query[type]": "earning",
        "store_id": tag,
    })
    url = f"https://affiliate-program.amazon.com/reporting/summary?{params}"

    headers = {
        "Cookie": cookies,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://affiliate-program.amazon.com/",
        "X-Requested-With": "XMLHttpRequest",
        "language": "en_US",
        "locale": "en_US",
        "programid": "1",
        "roles": "Primary",
        "storeid": tag,
    }
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    if csrf_token:
        headers["X-Csrf-Token"] = csrf_token
    if customer_id:
        headers["customerid"] = customer_id
    if marketplace_id:
        headers["marketplaceid"] = marketplace_id

    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            body = resp.read().decode("utf-8")[:300]
            print(f"\n  API test: HTTP {status}")
            print(f"  Response: {body[:200]}")
            return status == 200
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")[:200]
        except Exception:
            pass
        print(f"\n  API test: HTTP {e.code} — {'AUTH FAILED' if e.code == 401 else 'ERROR'}")
        if body:
            print(f"  Body: {body[:100]}")
        return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Refresh Amazon Associates session cookies")
    parser.add_argument(
        "--creator",
        default="nicki",
        choices=["nicki", "ann", "ellen", "emily", "all"],
        help="Which creator's cookies to refresh (default: nicki)",
    )
    parser.add_argument(
        "--test-only",
        action="store_true",
        help="Only test existing cookies without refreshing",
    )
    parser.add_argument(
        "--setup",
        action="store_true",
        help="DEPRECATED — login is now always headless. Use --sms-code if needed.",
    )
    parser.add_argument(
        "--sms-code",
        default="",
        help="Pass the SMS 2FA code directly (skip the prompt). Useful for scripting.",
    )
    args = parser.parse_args()

    creators = ["nicki", "ann", "ellen", "emily"] if args.creator == "all" else [args.creator]

    for creator in creators:
        if args.test_only:
            valid = test_cookies(creator)
            print(f"{'✅' if valid else '❌'} {creator}: {'valid' if valid else 'EXPIRED — run without --test-only'}")
        else:
            try:
                refresh_creator(creator, sms_code=args.sms_code)
                print(f"\nTesting refreshed cookies...")
                test_cookies(creator)
            except Exception as e:
                print(f"\n❌ Failed to refresh {creator}: {e}")
                sys.exit(1)
