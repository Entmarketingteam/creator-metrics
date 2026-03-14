#!/usr/bin/env python3
"""
Get Amazon Associates session cookies via Chrome CDP and save to Doppler.
Run this once — cookies last ~30 days, then re-run.

Usage:
    python3 tools/get-amazon-cookies.py
    python3 tools/get-amazon-cookies.py --creator nicki
"""

import argparse
import json
import subprocess
import sys
import time
import urllib.request

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PROFILE_DIR = r"C:\Users\ethan.atchley\AppData\Local\creator-metrics\amz-debug"
CDP_URL = "http://127.0.0.1:9222"

DOPPLER_PROJECT = "ent-agency-analytics"
DOPPLER_CONFIG = "prd"

CREATORS = {
    "nicki": "nickientenman-20",
    "ann":   "annschulte-20",
    "ellen": "ellenludwig-20",
    "emily": "livefitwithem-20",
}


def cdp_ready():
    try:
        urllib.request.urlopen(f"{CDP_URL}/json/version", timeout=2)
        return True
    except Exception:
        return False


def launch_chrome():
    print("Launching Chrome with debug profile...")
    subprocess.Popen([
        CHROME_PATH,
        "--remote-debugging-port=9222",
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "https://affiliate-program.amazon.com/p/reporting/earnings",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print("Waiting for Chrome", end="", flush=True)
    for _ in range(30):
        time.sleep(1)
        print(".", end="", flush=True)
        if cdp_ready():
            print(" ready.\n")
            return
    print("\nERROR: Chrome did not start. Check path:", CHROME_PATH)
    sys.exit(1)


def save_to_doppler(key, value):
    r = subprocess.run(
        ["doppler", "secrets", "set", f"{key}={value}",
         "--project", DOPPLER_PROJECT, "--config", DOPPLER_CONFIG],
        capture_output=True, text=True,
    )
    if r.returncode == 0:
        print(f"  ✅ {key} → Doppler")
    else:
        print(f"  ❌ {key}: {r.stderr.strip()}")


def run(creator):
    tag = CREATORS[creator]
    prefix = f"AMAZON_{creator.upper()}"

    if cdp_ready():
        print("Chrome already running with debug port.\n")
    else:
        launch_chrome()

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP_URL)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()

        # Find or open Associates page
        pg = None
        for tab in ctx.pages:
            if "affiliate-program.amazon.com" in tab.url:
                pg = tab
                break
        if pg is None:
            pg = ctx.new_page()
            pg.goto("https://affiliate-program.amazon.com/p/reporting/earnings",
                    wait_until="domcontentloaded")

        # Capture bearer token from outgoing requests
        captured = {"bearer": None, "csrf": None}

        def on_request(req):
            auth = req.headers.get("authorization", "")
            if auth.startswith("Bearer ") and "affiliate-program.amazon.com" in req.url:
                captured["bearer"] = auth[7:]
            csrf = req.headers.get("x-csrf-token", "")
            if csrf:
                captured["csrf"] = csrf

        pg.on("request", on_request)

        # Wait for Associates Central
        print("Waiting for Associates Central login...")
        print("(If not logged in, log in now in the Chrome window)\n")
        while True:
            url = pg.url.split("?")[0]
            if (url.startswith("https://affiliate-program.amazon.com")
                    and "signin" not in url
                    and "/ap/" not in url):
                break
            print(f"  {url[:80]}", flush=True)
            time.sleep(3)

        print(f"\n✅ On Associates Central: {pg.url[:80]}")

        # Navigate to earnings page to trigger /reporting/summary calls (captures real CSRF)
        print("  Navigating to earnings page to capture reporting API CSRF...")
        pg.goto("https://affiliate-program.amazon.com/p/reporting/earnings",
                wait_until="networkidle", timeout=30000)
        time.sleep(3)

        # Grab CSRF from page meta tag if not captured from requests
        if not captured["csrf"]:
            captured["csrf"] = pg.evaluate("""() => {
                const m = document.querySelector('meta[name="csrf-token"]');
                return m ? m.getAttribute('content') : null;
            }""")

        # Grab customer ID from page
        customer_id = pg.evaluate("""() => {
            try {
                const s = JSON.stringify(window.__AA_BOOTSTRAP__ || window.aaData || {});
                const m = s.match(/"customerId":"([A-Z0-9]{10,20})"/);
                return m ? m[1] : null;
            } catch(e) { return null; }
        }""")

        # Get ALL cookies via CDP (bypasses Chrome App-Bound Encryption on Windows)
        cdp_session = ctx.new_cdp_session(pg)
        raw = cdp_session.send("Network.getAllCookies")
        all_cookies = raw.get("cookies", [])

        browser.close()

    print(f"\nExtracted: {len(all_cookies)} cookies")

    if not all_cookies:
        print("\n❌ No cookies found — make sure you're logged into Amazon Associates.")
        sys.exit(1)

    # Deduplicate and build cookie string
    seen = {}
    for c in all_cookies:
        if c["name"] not in seen:
            seen[c["name"]] = c["value"]

    cookie_str = "; ".join(f"{k}={v}" for k, v in seen.items())

    print(f"\nSaving to Doppler (project={DOPPLER_PROJECT}, config={DOPPLER_CONFIG})...")
    save_to_doppler(f"{prefix}_COOKIES", cookie_str)

    if captured["csrf"]:
        save_to_doppler(f"{prefix}_CSRF_TOKEN", captured["csrf"])
    else:
        print(f"  ⚠ CSRF token not captured — {prefix}_CSRF_TOKEN unchanged")

    if customer_id:
        save_to_doppler(f"{prefix}_CUSTOMER_ID", customer_id)

    save_to_doppler(f"{prefix}_MARKETPLACE_ID", "ATVPDKIKX0DER")

    print(f"\nDone. Test with:")
    print(f"  python3 tools/amazon-data-sync.py --creator {creator} --dry-run")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--creator", default="nicki", choices=list(CREATORS))
    args = ap.parse_args()
    run(args.creator)


if __name__ == "__main__":
    main()
