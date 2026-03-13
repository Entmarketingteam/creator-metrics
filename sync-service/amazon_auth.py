"""
Amazon Associates cookie auto-refresh.

How it works:
  1. First-time setup: run extract_amazon_cookies.py locally — logs in via visible browser,
     captures ALL cookies including x-main (the "trusted device" token), saves to Doppler.

  2. Session refresh (this module): when session-id expires, do an HTTP-only re-login.
     Amazon skips 2FA when x-main is present (device is trusted). No browser needed.

  3. Full re-auth (nuclear option): if x-main also expired (~1 year), generate a TOTP
     code from the stored TOTP seed and complete the full login flow headlessly.

Doppler secrets (ent-agency-automation, per creator):
  AMAZON_{ID}_EMAIL           e.g. AMAZON_NICKI_EMAIL
  AMAZON_{ID}_PASSWORD        e.g. AMAZON_NICKI_PASSWORD
  AMAZON_{ID}_TOTP_SECRET     e.g. AMAZON_NICKI_TOTP_SECRET   (base32 seed, optional)
  AMAZON_{ID}_SESSION_COOKIES e.g. AMAZON_NICKI_SESSION_COOKIES  (session-id; session-token)
  AMAZON_{ID}_X_MAIN          e.g. AMAZON_NICKI_X_MAIN           (long-lived device trust)
"""

import logging
import os
import re
import time
from typing import Optional
from urllib.parse import urlencode

import httpx
import pyotp

logger = logging.getLogger(__name__)

DOPPLER_PROJECT = "ent-agency-automation"
DOPPLER_CONFIG = "prd"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

_SIGNIN_URL = (
    "https://www.amazon.com/ap/signin"
    "?openid.pape.max_auth_age=0"
    "&openid.return_to=https%3A%2F%2Faffiliate-program.amazon.com%2Fhome"
    "&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select"
    "&openid.assoc_handle=usflex"
    "&openid.mode=checkid_setup"
    "&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select"
    "&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0"
)


def _parse_cookie_str(cookie_str: str) -> dict:
    result = {}
    for part in (cookie_str or "").split(";"):
        part = part.strip()
        if "=" in part:
            k, _, v = part.partition("=")
            result[k.strip()] = v.strip()
    return result


def _extract_form_field(html: str, name: str) -> Optional[str]:
    """Pull a hidden input value from an HTML form."""
    pattern = rf'<input[^>]+name="{re.escape(name)}"[^>]+value="([^"]*)"'
    m = re.search(pattern, html)
    if not m:
        pattern = rf'<input[^>]+value="([^"]*)"[^>]+name="{re.escape(name)}"'
        m = re.search(pattern, html)
    return m.group(1) if m else None


def _cookies_are_valid(session_cookies: dict, x_main: Optional[str]) -> bool:
    """Quick health check — hit Associates Central, see if we land on the dashboard."""
    all_cookies = dict(session_cookies)
    if x_main:
        all_cookies["x-main"] = x_main

    try:
        with httpx.Client(
            headers=_HEADERS,
            cookies=all_cookies,
            follow_redirects=False,
            timeout=15,
        ) as client:
            resp = client.get("https://affiliate-program.amazon.com/home/summary")
            # 200 on Associates = logged in. Redirect to amazon.com/ap/signin = expired.
            if resp.status_code == 200:
                body = resp.text
                if "affiliate-program.amazon.com" in str(resp.url) and "signout" in body.lower():
                    return True
            return False
    except Exception as e:
        logger.warning(f"Cookie health check error: {e}")
        return False


def _save_to_doppler(key: str, value: str, doppler_token: Optional[str] = None) -> bool:
    """Save a secret to Doppler via API. Returns True on success."""
    token = doppler_token or os.environ.get("DOPPLER_SERVICE_TOKEN")
    if not token:
        logger.warning("No DOPPLER_SERVICE_TOKEN — cannot auto-save cookies to Doppler")
        return False

    try:
        resp = httpx.post(
            "https://api.doppler.com/v3/configs/config/secrets",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "project": DOPPLER_PROJECT,
                "config": DOPPLER_CONFIG,
                "secrets": {key: value},
            },
            timeout=15,
        )
        resp.raise_for_status()
        logger.info(f"✓ {key} saved to Doppler")
        return True
    except Exception as e:
        logger.error(f"Doppler save failed for {key}: {e}")
        return False


def _http_login(
    email: str,
    password: str,
    totp_secret: Optional[str],
    x_main: Optional[str],
) -> Optional[dict]:
    """
    Perform Amazon login via HTTP form posts.
    Returns dict of fresh cookies on success, None on failure.

    When x_main is provided, Amazon recognizes the device and skips 2FA.
    When totp_secret is also provided, we can handle 2FA if it is requested.
    """
    with httpx.Client(
        headers=_HEADERS,
        follow_redirects=True,
        timeout=30,
    ) as client:
        # Seed the client with our device trust cookie before any requests
        if x_main:
            client.cookies.set("x-main", x_main, domain=".amazon.com")

        # Step 1 — Load the sign-in form to get hidden CSRF/OpenID fields
        logger.info("Loading Amazon sign-in page...")
        resp = client.get(_SIGNIN_URL)
        if resp.status_code != 200:
            logger.error(f"Sign-in page returned {resp.status_code}")
            return None

        html = resp.text
        email_field = _extract_form_field(html, "email")

        # Collect all hidden form fields
        hidden_fields = {}
        for m in re.finditer(r'<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"', html):
            hidden_fields[m.group(1)] = m.group(2)
        for m in re.finditer(r'<input[^>]+name="([^"]+)"[^>]+type="hidden"[^>]+value="([^"]*)"', html):
            hidden_fields[m.group(1)] = m.group(2)

        # Step 2 — Submit email
        logger.info("Submitting email...")
        payload = {**hidden_fields, "email": email, "continue": "Continue"}
        resp = client.post("https://www.amazon.com/ap/signin", data=payload)
        html = resp.text

        # Refresh hidden fields for password step
        hidden_fields = {}
        for m in re.finditer(r'<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"', html):
            hidden_fields[m.group(1)] = m.group(2)
        for m in re.finditer(r'<input[^>]+name="([^"]+)"[^>]+type="hidden"[^>]+value="([^"]*)"', html):
            hidden_fields[m.group(1)] = m.group(2)

        # Step 3 — Submit password
        logger.info("Submitting password...")
        payload = {**hidden_fields, "password": password, "rememberMe": "true", "signIn": "Sign in"}
        resp = client.post("https://www.amazon.com/ap/signin", data=payload)
        html = resp.text

        # Step 4 — Check if 2FA is required
        needs_otp = (
            "ap/mfa" in resp.url.lower()
            or "Enter OTP" in html
            or "Verify your identity" in html
            or 'name="otpCode"' in html
        )

        if needs_otp:
            if not totp_secret:
                logger.error("2FA required but no TOTP secret stored — cannot complete login")
                return None

            logger.info("Generating TOTP code...")
            otp_code = pyotp.TOTP(totp_secret).now()

            hidden_fields = {}
            for m in re.finditer(r'<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"', html):
                hidden_fields[m.group(1)] = m.group(2)
            for m in re.finditer(r'<input[^>]+name="([^"]+)"[^>]+type="hidden"[^>]+value="([^"]*)"', html):
                hidden_fields[m.group(1)] = m.group(2)

            payload = {**hidden_fields, "otpCode": otp_code, "rememberDevice": "true"}
            resp = client.post(str(resp.url), data=payload)
            html = resp.text

        # Step 5 — Verify we landed on Associates Central
        if "affiliate-program.amazon.com" not in str(resp.url):
            # May need one more redirect
            resp = client.get("https://affiliate-program.amazon.com/home")

        if "affiliate-program.amazon.com" not in str(resp.url):
            logger.error(f"Login did not reach Associates Central. Final URL: {resp.url}")
            logger.debug(f"Response snippet: {resp.text[:500]}")
            return None

        logger.info(f"✓ Login successful. URL: {resp.url}")

        # Step 6 — Extract all cookies from the session
        cookies = {}
        for cookie in client.cookies.jar:
            cookies[cookie.name] = cookie.value

        return cookies


def refresh_cookies_if_needed(creator: dict) -> Optional[dict]:
    """
    Main entry point. Checks health, refreshes if needed, returns current cookies.

    creator dict keys:
      id             — e.g. "nicki_entenmann"
      email_env      — env var name for email
      password_env   — env var name for password
      totp_env       — env var name for TOTP seed (optional)
      session_env    — env var name for session cookies string
      x_main_env     — env var name for x-main cookie value
    """
    creator_id = creator["id"]
    tag = creator.get("tag", creator_id.upper())

    session_str = os.environ.get(creator["session_env"], "")
    x_main = os.environ.get(creator.get("x_main_env", ""), "")

    session_cookies = _parse_cookie_str(session_str)

    # ── Health check ────────────────────────────────────────────────────────
    if session_cookies and _cookies_are_valid(session_cookies, x_main):
        logger.info(f"[{creator_id}] Cookies valid — no refresh needed")
        return {**session_cookies, **({"x-main": x_main} if x_main else {})}

    logger.info(f"[{creator_id}] Cookies expired — attempting HTTP re-login")

    # ── Credentials ─────────────────────────────────────────────────────────
    email = os.environ.get(creator["email_env"])
    password = os.environ.get(creator["password_env"])
    totp_secret = os.environ.get(creator.get("totp_env", ""), "") or None

    if not email or not password:
        logger.error(f"[{creator_id}] Missing email or password env vars — cannot refresh")
        return None

    # ── Re-login ─────────────────────────────────────────────────────────────
    fresh_cookies = _http_login(email, password, totp_secret, x_main or None)
    if not fresh_cookies:
        logger.error(f"[{creator_id}] Re-login failed")
        return None

    # ── Save fresh cookies back to Doppler ───────────────────────────────────
    # Split: session cookies (short-lived) vs x-main (long-lived device trust)
    DEVICE_TRUST_KEYS = {"x-main", "ubid-main", "i18n-prefs"}
    SESSION_KEYS = {"session-id", "session-token", "session-id-time", "sess-at-main", "at-main", "csm-hit"}

    session_parts = {k: v for k, v in fresh_cookies.items() if k in SESSION_KEYS}
    new_x_main = fresh_cookies.get("x-main")

    session_key = creator["session_env"]
    x_main_key = creator.get("x_main_env")

    _save_to_doppler(session_key, "; ".join(f"{k}={v}" for k, v in session_parts.items()))
    if new_x_main and x_main_key:
        _save_to_doppler(x_main_key, new_x_main)

    logger.info(f"[{creator_id}] ✓ Cookies refreshed and saved to Doppler")
    return fresh_cookies


# ── Creator registry ──────────────────────────────────────────────────────────

CREATORS = [
    {
        "id": "nicki_entenmann",
        "email_env": "AMAZON_NICKI_EMAIL",
        "password_env": "AMAZON_NICKI_PASSWORD",
        "totp_env": "AMAZON_NICKI_TOTP_SECRET",
        "session_env": "AMAZON_NICKI_SESSION_COOKIES",
        "x_main_env": "AMAZON_NICKI_X_MAIN",
        "customer_id_env": "AMAZON_NICKI_CUSTOMER_ID",
        "tag": "nickientenman-20",
    },
    {
        "id": "annbschulte",
        "email_env": "AMAZON_ANN_EMAIL",
        "password_env": "AMAZON_ANN_PASSWORD",
        "totp_env": "AMAZON_ANN_TOTP_SECRET",
        "session_env": "AMAZON_ANN_SESSION_COOKIES",
        "x_main_env": "AMAZON_ANN_X_MAIN",
        "customer_id_env": "AMAZON_ANN_CUSTOMER_ID",
        "tag": None,
    },
    {
        "id": "ellenludwigfitness",
        "email_env": "AMAZON_ELLEN_EMAIL",
        "password_env": "AMAZON_ELLEN_PASSWORD",
        "totp_env": "AMAZON_ELLEN_TOTP_SECRET",
        "session_env": "AMAZON_ELLEN_SESSION_COOKIES",
        "x_main_env": "AMAZON_ELLEN_X_MAIN",
        "customer_id_env": "AMAZON_ELLEN_CUSTOMER_ID",
        "tag": None,
    },
    {
        "id": "livefitwithem",
        "email_env": "AMAZON_EMILY_EMAIL",
        "password_env": "AMAZON_EMILY_PASSWORD",
        "totp_env": "AMAZON_EMILY_TOTP_SECRET",
        "session_env": "AMAZON_EMILY_SESSION_COOKIES",
        "x_main_env": "AMAZON_EMILY_X_MAIN",
        "customer_id_env": "AMAZON_EMILY_CUSTOMER_ID",
        "tag": None,
    },
]
