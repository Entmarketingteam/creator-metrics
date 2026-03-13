"""
One-time setup: extract Amazon Associates cookies via visible browser.

Run this locally (NOT on Railway) so Amazon sees your real IP and won't flag it.
After this, the auto-refresh system handles everything — you shouldn't need to run
this again for ~1 year (when x-main expires).

Usage:
  cd sync-service
  pip install playwright pyotp
  playwright install chromium
  python extract_amazon_cookies.py           # all creators
  python extract_amazon_cookies.py nicki     # just Nicki

Saves to Doppler (ent-agency-automation, prd):
  AMAZON_NICKI_SESSION_COOKIES  — short-lived session cookies
  AMAZON_NICKI_X_MAIN           — long-lived device trust token (~1 year)
  AMAZON_NICKI_TOTP_SECRET      — 2FA seed (optional — enables full headless re-auth)
"""
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

DOPPLER_PROJECT = "ent-agency-automation"
DOPPLER_CONFIG = "prd"

SESSION_COOKIE_NAMES = {
    "session-id",
    "session-token",
    "session-id-time",
    "sess-at-main",
    "at-main",
    "csm-hit",
}

# x-main is the "trusted device" token — present = Amazon skips 2FA on re-login
DEVICE_TRUST_COOKIE_NAMES = {"x-main", "ubid-main"}


def save_to_doppler(key: str, value: str):
    result = subprocess.run(
        ["doppler", "secrets", "set", f"{key}={value}",
         "--project", DOPPLER_PROJECT, "--config", DOPPLER_CONFIG],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  ⚠️  Doppler error for {key}: {result.stderr.strip()}")
    else:
        print(f"  ✓  {key} → Doppler")


def run_for_creator(creator_name: str, env_prefix: str):
    print(f"\n{'='*60}")
    print(f"  Setting up: {creator_name}  ({env_prefix})")
    print(f"{'='*60}")
    print("\nOpening browser — log into Amazon Associates normally.")
    print("Complete the login including 2FA (this is the LAST TIME).")
    print("Script auto-detects when you reach Associates Central.\n")
    sys.stdout.flush()

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=["--start-maximized", "--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            viewport=None,
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        page.goto("https://affiliate-program.amazon.com/home")

        print("Waiting for you to complete login...")
        sys.stdout.flush()
        while True:
            time.sleep(2)
            try:
                url = page.url
                print(f"  current url: {url[:80]}", flush=True)
                if url.startswith("https://affiliate-program.amazon.com") and "signin" not in url:
                    print("✓ Detected Associates Central", flush=True)
                    break
            except Exception:
                pass

        time.sleep(2)  # let React hydrate

        all_cookies = (
            context.cookies("https://www.amazon.com")
            + context.cookies("https://affiliate-program.amazon.com")
        )
        browser.close()

    session_cookies = {}
    device_cookies = {}
    for c in all_cookies:
        name = c["name"]
        if name in SESSION_COOKIE_NAMES and name not in session_cookies:
            session_cookies[name] = c["value"]
        elif name in DEVICE_TRUST_COOKIE_NAMES and name not in device_cookies:
            device_cookies[name] = c["value"]

    print(f"\nCaptured {len(session_cookies)} session + {len(device_cookies)} device cookies", flush=True)

    if not session_cookies:
        print("❌ No cookies found.")
        return False

    session_str = "; ".join(f"{k}={v}" for k, v in session_cookies.items())
    save_to_doppler(f"{env_prefix}_SESSION_COOKIES", session_str)

    if "x-main" in device_cookies:
        save_to_doppler(f"{env_prefix}_X_MAIN", device_cookies["x-main"])
        print("✅ x-main saved — future re-logins will NOT require 2FA")
    else:
        print("⚠️  x-main not found — check 'Keep me signed in' next time")

    # TOTP: read from env var if set, otherwise skip (no interactive prompt)
    totp = os.environ.get(f"{env_prefix}_TOTP_SECRET", "").strip()
    if totp:
        save_to_doppler(f"{env_prefix}_TOTP_SECRET", totp)
        print("✓ TOTP secret saved")
    else:
        print("ℹ️  No TOTP secret — skipping (add to Doppler manually if needed)")

    print(f"✅ {creator_name} done!\n", flush=True)
    return True


def main():
    creators = [
        ("Nicki Entenmann",       "AMAZON_NICKI"),
        ("Ann Schulte",           "AMAZON_ANN"),
        ("Ellen Ludwig",          "AMAZON_ELLEN"),
        ("Emily (livefitwithem)", "AMAZON_EMILY"),
    ]

    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()
        creators = [(n, p) for n, p in creators if arg in n.lower() or arg in p.lower()]
        if not creators:
            print(f"No match for '{arg}'. Options: nicki, ann, ellen, emily")
            sys.exit(1)

    print("Amazon Associates — One-Time Cookie Setup")
    print("Run once per creator. Auto-refresh handles everything after.\n")
    sys.stdout.flush()

    for name, prefix in creators:
        run_for_creator(name, prefix)

    print("🎉 All done — cookies saved to Doppler.")


if __name__ == "__main__":
    main()
