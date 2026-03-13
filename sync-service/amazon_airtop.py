"""
Amazon Associates login via Airtop cloud browser.

Same pattern as LTK token refresh — Airtop spins up a real browser on a
residential IP, logs into Amazon Associates, extracts the Bearer JWE token
and CSRF token from the page DOM, then closes the browser.

These tokens are then used by amazon_reporting_api.fetch_earnings() to
trigger the CSV export and download earnings data — all from Railway,
no local machine needed.
"""

import json
import logging
import os
import time
import urllib.error
import urllib.request
from typing import Optional

import pyotp

logger = logging.getLogger(__name__)

AIRTOP_BASE = "https://api.airtop.ai/api/v1"
ASSOCIATES_HOME = "https://affiliate-program.amazon.com/home"
REPORTING_PAGE = "https://affiliate-program.amazon.com/p/reporting/earnings"


def _airtop(method: str, path: str, body=None, airtop_key: str = None) -> dict:
    key = airtop_key or os.environ["AIRTOP_API_KEY"]
    url = f"{AIRTOP_BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Airtop {method} {path} → {e.code}: {e.read().decode()}")


def get_amazon_tokens(
    email: str,
    password: str,
    totp_secret: Optional[str] = None,
    store_id: str = None,
) -> Optional[dict]:
    """
    Use Airtop to log into Amazon Associates and extract Bearer + CSRF tokens.

    Returns:
        {
            "bearer": "eyJ6aXAi...",
            "csrf": "hACOyE7g...",
            "customer_id": "A1J742SMH1JPDV",
            "session_cookies": {...},
        }
        or None on failure.
    """
    airtop_key = os.environ["AIRTOP_API_KEY"]

    # Clean up stale sessions first (Airtop free plan has session limits)
    logger.info("Cleaning up stale Airtop sessions...")
    try:
        existing = _airtop("GET", "/sessions", airtop_key=airtop_key)
        for s in existing.get("data", {}).get("sessions", []):
            try:
                _airtop("DELETE", f"/sessions/{s['id']}", airtop_key=airtop_key)
            except Exception:
                pass
    except Exception as e:
        logger.warning("Could not clean Airtop sessions: %s", e)

    logger.info("Creating Airtop session for Amazon Associates login...")
    session = _airtop("POST", "/sessions", {"configuration": {"timeoutMinutes": 10}}, airtop_key=airtop_key)
    session_id = session["data"]["id"]

    # Wait for session to be running (up to 3 min)
    for attempt in range(90):
        session_data = _airtop("GET", f"/sessions/{session_id}", airtop_key=airtop_key)["data"]
        status = session_data.get("status", "unknown")
        if status == "running":
            break
        if attempt % 5 == 0:
            logger.info("Airtop session status: %s (attempt %d/90)", status, attempt + 1)
        time.sleep(2)
    else:
        raise RuntimeError(f"Airtop session never reached running state (last status: {status})")

    # Open a blank page first so we can inject cookies before navigating
    _airtop("POST", f"/sessions/{session_id}/windows", {"url": "https://www.amazon.com"}, airtop_key=airtop_key)
    cdp_ws = _airtop("GET", f"/sessions/{session_id}", airtop_key=airtop_key)["data"]["cdpWsUrl"]
    logger.info("Airtop session running, connecting via Playwright CDP")

    from playwright.sync_api import sync_playwright

    result = None

    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(
                cdp_ws,
                headers={"Authorization": f"Bearer {airtop_key}"}
            )
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()

            # Wait for page to settle (amazon.com loaded)
            page.wait_for_load_state("domcontentloaded", timeout=15000)

            # Try injecting saved session cookies first (avoids login + 2FA)
            saved_cookies_str = os.environ.get(f"AMAZON_{store_id.upper().replace('-','_')}_SESSION_COOKIES", "") if store_id else ""
            # Also try AMAZON_NICKI_SESSION_COOKIES pattern
            if not saved_cookies_str:
                # Map store_id to creator name for env var lookup
                store_env_map = {"nickientenman-20": "NICKI", "nickientenmann-20": "NICKI"}
                creator_key = store_env_map.get(store_id, "")
                if creator_key:
                    saved_cookies_str = os.environ.get(f"AMAZON_{creator_key}_SESSION_COOKIES", "")

            if saved_cookies_str:
                logger.info("Injecting saved session cookies into browser...")
                cookies = []
                for pair in saved_cookies_str.split(";"):
                    pair = pair.strip()
                    if "=" in pair:
                        name, _, value = pair.partition("=")
                        cookies.append({"name": name.strip(), "value": value.strip(),
                                        "domain": ".amazon.com", "path": "/"})

                # Also inject x-main cookie (long-lived, stored separately)
                creator_key2 = store_env_map.get(store_id, "") if store_id else ""
                x_main = os.environ.get(f"AMAZON_{creator_key2}_X_MAIN", "") if creator_key2 else ""
                if x_main:
                    cookies.append({"name": "x-main", "value": x_main,
                                    "domain": ".amazon.com", "path": "/"})

                try:
                    context = page.context
                    context.add_cookies(cookies)
                    logger.info("Injected %d cookies — navigating to Associates...", len(cookies))
                    page.goto(ASSOCIATES_HOME, wait_until="domcontentloaded", timeout=30000)
                    # Wait up to 8 seconds for any JS redirects to settle
                    for _ in range(8):
                        time.sleep(1)
                        if "signin" in page.url or page.url == ASSOCIATES_HOME or "affiliate-program.amazon.com" in page.url:
                            break
                    if "affiliate-program.amazon.com" in page.url and "signin" not in page.url:
                        logger.info("Cookie injection succeeded (url=%s) — skipped login", page.url)
                    else:
                        logger.info("Cookies invalid/expired (url=%s) — falling back to login", page.url)
                        saved_cookies_str = ""  # Force login fallback
                except Exception as ce:
                    logger.warning("Cookie injection failed: %s — falling back to login", ce)
                    saved_cookies_str = ""

            if not saved_cookies_str:
                # Fall back to fresh login
                current_url = page.url
                logger.info("Initial URL: %s", current_url)

                if "signin" in current_url or "ap/signin" in current_url:
                    logger.info("On sign-in page, filling credentials...")
                    _do_login(page, email, password, totp_secret)
                else:
                    page.goto(ASSOCIATES_HOME, wait_until="domcontentloaded", timeout=30000)
                    time.sleep(2)
                    if "signin" in page.url or "ap/signin" in page.url:
                        logger.info("Redirected to sign-in, filling credentials...")
                        _do_login(page, email, password, totp_secret)

            # Confirm we're on Associates Central
            final_url = page.url
            logger.info("Post-login URL: %s", final_url)
            if "affiliate-program.amazon.com" not in final_url:
                # Capture page state for diagnosis
                try:
                    error_text = page.evaluate("""() => {
                        const els = [...document.querySelectorAll(".a-alert-content, #auth-error-message-box, #auth-warning, h1, h4, p")];
                        return els.map(e => e.textContent.trim()).filter(Boolean).slice(0, 5).join(" | ");
                    }""")
                    logger.error("Amazon page content after login: %s", error_text or "(empty)")
                    logger.error("Page title: %s", page.title())
                except Exception as _dbg:
                    logger.warning("Debug capture failed: %s", _dbg)
                logger.error("Login failed — stuck at: %s", final_url)
                return None

            logger.info("Logged in. Navigating to reporting page...")
            page.goto(REPORTING_PAGE, wait_until="domcontentloaded", timeout=30000)
            time.sleep(3)  # Let React hydrate

            # Extract Bearer token from page HTML
            bearer = page.evaluate("""() => {
                const m = document.documentElement.innerHTML.match(/eyJ6aXAiOiJERUYi[A-Za-z0-9._\\-]+/);
                return m ? m[0] : null;
            }""")

            # Extract CSRF from meta tag
            csrf = page.evaluate("""() => {
                const el = document.querySelector('meta[name="anti-csrftoken-a2z"]');
                return el ? el.getAttribute('content') : null;
            }""")

            # Extract customer ID from page HTML
            customer_id = page.evaluate("""() => {
                const m = document.documentElement.innerHTML.match(/"customerId"\\s*:\\s*"([A-Z0-9]{10,20})"/);
                return m ? m[1] : null;
            }""")

            logger.info("Extracted — bearer: %s  csrf: %s  customer_id: %s",
                        "✓" if bearer else "✗",
                        "✓" if csrf else "✗",
                        customer_id or "✗")

            if not bearer or not csrf:
                logger.error("Could not extract tokens from reporting page")
                return None

            # Grab session cookies for any follow-up requests
            raw_cookies = context.cookies("https://www.amazon.com") + \
                          context.cookies("https://affiliate-program.amazon.com")
            session_cookies = {c["name"]: c["value"] for c in raw_cookies}

            result = {
                "bearer": bearer,
                "csrf": csrf,
                "customer_id": customer_id,
                "session_cookies": session_cookies,
            }

            browser.close()

    finally:
        try:
            _airtop("DELETE", f"/sessions/{session_id}", airtop_key=airtop_key)
            logger.info("Airtop session closed")
        except Exception:
            pass

    return result


def _do_login(page, email: str, password: str, totp_secret=None):
    """Fill Amazon two-step sign-in form (email → continue → password → submit)."""
    logger.info("Step 1: filling email...")

    # Dismiss passkey prompt if shown (Amazon shows this on accounts with passkeys)
    try:
        different_way = page.locator('button:has-text("different"), a:has-text("different"), button:has-text("password")')
        if different_way.count() > 0:
            logger.info("Passkey prompt detected - clicking sign in different way")
            different_way.first.click(timeout=3000)
            page.wait_for_load_state("domcontentloaded", timeout=10000)
    except Exception:
        pass

    # Step 1: Email field
    # Amazon may pre-fill the email (hidden input) — check if email is visible or pre-filled
    try:
        # Check if email is already pre-filled (hidden input with our email value)
        pre_filled = page.locator(f'input[name="email"][value="{email}"][type="hidden"]')
        if pre_filled.count() > 0:
            logger.info("Email pre-filled by Amazon — clicking Continue...")
        else:
            # Email field is visible — fill it
            page.wait_for_selector('input[name="email"]:not([type="hidden"])', timeout=10000)
            page.fill('input[name="email"]', email)
    except Exception:
        # Fallback: try to fill visible email field
        try:
            page.fill('input[name="email"]', email)
        except Exception:
            pass
    # Click Continue button
    try:
        page.click('input[id="continue"]', timeout=5000)
    except Exception:
        try:
            page.click('button[type="submit"]', timeout=5000)
        except Exception:
            page.keyboard.press("Enter")

    # Step 2: Wait for password field to appear
    logger.info("Step 2: waiting for password field...")
    try:
        page.wait_for_selector('input[name="password"]', timeout=15000)
    except Exception:
        logger.warning("Password field did not appear after email step")
        return

    page.fill('input[name="password"]', password)

    # Check "Keep me signed in" if available
    try:
        page.check('input[name="rememberMe"]', timeout=2000)
    except Exception:
        pass

    # Submit
    logger.info("Step 3: submitting password...")
    try:
        page.click('input[id="signInSubmit"]', timeout=5000)
    except Exception:
        try:
            page.click('button[type="submit"]', timeout=5000)
        except Exception:
            page.keyboard.press("Enter")

    # Wait for navigation
    try:
        page.wait_for_load_state("domcontentloaded", timeout=20000)
    except Exception:
        pass
    import time; time.sleep(3)

    # Handle TOTP / OTP if prompted
    html = page.content()
    current_url = page.url
    needs_otp = (
        "ap/mfa" in current_url.lower()
        or "Enter OTP" in html
        or "Verify your identity" in html
        or 'name="otpCode"' in html
        or "Two-Step Verification" in html
        or "approval needed" in html.lower()
    )

    if needs_otp:
        if not totp_secret:
            logger.warning("2FA required but no TOTP secret available")
            return

        import pyotp as _pyotp
        logger.info("2FA required — generating TOTP code...")
        otp = _pyotp.TOTP(totp_secret).now()
        try:
            page.wait_for_selector(
                'input[name="otpCode"], input[type="tel"], input[autocomplete="one-time-code"]',
                timeout=10000
            )
            page.fill(
                'input[name="otpCode"], input[type="tel"], input[autocomplete="one-time-code"]',
                otp
            )
        except Exception as e:
            logger.warning("Could not fill OTP field: %s", e)
            return

        try:
            page.check('input[name="rememberDevice"]', timeout=2000)
        except Exception:
            pass

        try:
            page.click('[type="submit"]', timeout=5000)
        except Exception:
            page.keyboard.press("Enter")

        try:
            page.wait_for_load_state("domcontentloaded", timeout=20000)
        except Exception:
            pass
        time.sleep(2)

    logger.info("Login step complete. URL: %s", page.url)
