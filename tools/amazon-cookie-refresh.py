#!/usr/bin/env python3
"""
Amazon Associates Cookie Refresh
==================================
Uses real Chrome with a dedicated debug profile (separate from your daily Chrome).
First run: log in once in the Chrome window that opens. Session saves permanently.
Future runs: no login needed — session reused automatically.

Key fixes vs previous attempts:
  - Chrome 136+ requires --user-data-dir != default profile for CDP to work
  - Uses CDP Network.getAllCookies (bypasses Chrome App-Bound Encryption)
  - Network request interception captures bearer token automatically
  - Waits indefinitely for login rather than timing out

Usage:
    python3 tools/amazon-cookie-refresh.py
    python3 tools/amazon-cookie-refresh.py --creator nicki
"""

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request

DOPPLER_PROJECT = "ent-agency-analytics"
DOPPLER_CONFIG = "prd"

CREATORS = {
    "nicki": "nickientenman-20",
    "ann":   "annschulte-20",
    "ellen": "ellenludwig-20",
    "emily": "livefitwithem-20",
}

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
# Must NOT be Chrome's default profile dir — Chrome 136+ blocks CDP on default profile
PROFILE_DIR = r"C:\Users\ethan.atchley\AppData\Local\creator-metrics\amz-debug"
CDP_URL = "http://127.0.0.1:9222"


def save_to_doppler(key: str, value: str):
    r = subprocess.run(
        ["doppler", "secrets", "set", f"{key}={value}",
         "--project", DOPPLER_PROJECT, "--config", DOPPLER_CONFIG],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"  WARNING  {key}: {r.stderr.strip()}")
    else:
        print(f"  OK  {key}")


def chrome_is_ready() -> bool:
    try:
        urllib.request.urlopen(f"{CDP_URL}/json/version", timeout=2)
        return True
    except Exception:
        return False


def launch_chrome():
    print("Launching Chrome with debug profile...")
    print(f"Profile: {PROFILE_DIR}")
    subprocess.Popen(
        [
            CHROME_PATH,
            "--remote-debugging-port=9222",
            f"--user-data-dir={PROFILE_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            "--restore-last-session",
            "https://affiliate-program.amazon.com/home/reports",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print("Waiting for Chrome to start", end="", flush=True)
    for _ in range(30):
        time.sleep(1)
        print(".", end="", flush=True)
        if chrome_is_ready():
            print(" ready.")
            return
    print()
    print("ERROR: Chrome did not start within 30s.")
    print(f"Make sure Chrome is at: {CHROME_PATH}")
    sys.exit(1)


def extract_from_html(html: str):
    bearer, csrf, customer = None, None, None

    for p in [
        r'"associateIdentityToken"\s*:\s*"([^"]{50,})"',
        r"associateIdentityToken['\"]?\s*:\s*['\"]([^'\"]{50,})['\"]",
    ]:
        m = re.search(p, html)
        if m:
            bearer = m.group(1)
            break

    for p in [
        r'<meta\s+name="csrf-token"\s+content="([^"]+)"',
        r'<meta\s+content="([^"]+)"\s+name="csrf-token"',
        r'"csrf[-_]token"\s*:\s*"([^"]+)"',
    ]:
        m = re.search(p, html)
        if m:
            csrf = m.group(1)
            break

    for p in [
        r'"customerId"\s*:\s*"([A-Z0-9]{10,20})"',
        r'"customer_id"\s*:\s*"([A-Z0-9]{10,20})"',
        r'"associateId"\s*:\s*"([A-Z0-9]{10,20})"',
    ]:
        m = re.search(p, html)
        if m:
            customer = m.group(1)
            break

    return bearer, csrf, customer


def run(creator: str):
    if creator not in CREATORS:
        print(f"Unknown creator '{creator}'. Options: {', '.join(CREATORS)}")
        sys.exit(1)

    prefix = f"AMAZON_{creator.upper()}"

    print(f"\n{'='*60}")
    print(f"  Amazon Cookie Refresh — {creator}")
    print(f"{'='*60}\n")

    # Start Chrome if not already running with debug port
    if chrome_is_ready():
        print("Chrome already running with debug port.")
    else:
        launch_chrome()

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP_URL)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        print(f"Connected — {len(ctx.pages)} tab(s)\n")

        # Find or open Associates page
        pg = None
        for candidate in ctx.pages:
            if "affiliate-program.amazon.com" in candidate.url:
                pg = candidate
                break
        if pg is None:
            pg = ctx.new_page()
            pg.goto("https://affiliate-program.amazon.com/home/reports",
                    wait_until="domcontentloaded")

        # Intercept bearer token from outbound API requests
        captured = {"bearer": None}

        def on_request(req):
            auth = req.headers.get("authorization", "")
            if auth.startswith("Bearer ") and "affiliate-program.amazon.com" in req.url:
                captured["bearer"] = auth[len("Bearer "):]

        pg.on("request", on_request)

        # Wait (indefinitely) for Associates Central
        while True:
            path = pg.url.split("?")[0]
            if (path.startswith("https://affiliate-program.amazon.com")
                    and "signin" not in path
                    and "/ap/" not in path):
                break
            print(f"  Waiting for login... ({path[:70]})", flush=True)
            # If clearly on signin, prompt the user
            if "signin" in pg.url or "/ap/signin" in pg.url:
                print("\n  -> Log in to Amazon Associates in the Chrome window that opened.")
                print("     Use Nicki's email + password + SMS code.")
                print("     Script will auto-continue once you reach Associates Central.\n")
            time.sleep(3)

        print(f"  Associates Central: {pg.url[:70]}")
        time.sleep(2)

        # Trigger a page refresh so API requests fire (captures bearer via interception)
        pg.reload(wait_until="networkidle", timeout=30000)
        time.sleep(2)

        # Extract CSRF + customer from page content
        html = pg.content()
        bearer_html, csrf, customer = extract_from_html(html)

        # JS fallbacks
        bearer_js = pg.evaluate("""() => {
            try {
                const s = JSON.stringify(window.__AA_BOOTSTRAP__ || window.__aa__ || {});
                const m = s.match(/"associateIdentityToken":"([^"]{50,})"/);
                return m ? m[1] : null;
            } catch(e) { return null; }
        }""")
        if not csrf:
            csrf = pg.evaluate("""() => {
                const m = document.querySelector('meta[name="csrf-token"]');
                return m ? m.getAttribute('content') : null;
            }""")
        if not customer:
            customer = pg.evaluate("""() => {
                try {
                    const s = JSON.stringify(window.__AA_BOOTSTRAP__ || {});
                    const m = s.match(/"customerId":"([A-Z0-9]{10,20})"/);
                    return m ? m[1] : null;
                } catch(e) { return null; }
            }""")

        bearer = captured["bearer"] or bearer_js or bearer_html

        # Get ALL cookies via CDP (bypasses Chrome App-Bound Encryption)
        cdp = ctx.new_cdp_session(pg)
        raw = cdp.send("Network.getAllCookies")
        all_cookies = raw.get("cookies", [])

        browser.close()

    print(f"\nExtracted:")
    print(f"  cookies : {len(all_cookies)}")
    print(f"  bearer  : {'OK (' + str(len(bearer)) + ' chars)' if bearer else 'MISSING'}")
    print(f"  csrf    : {'OK' if csrf else 'MISSING'}")
    print(f"  customer: {customer or 'MISSING'}")

    if not all_cookies:
        print("\nERROR: No cookies — login may not have completed.")
        sys.exit(1)

    # Build Cookie header string
    seen = {}
    for c in all_cookies:
        if c["name"] not in seen:
            seen[c["name"]] = c["value"]
    cookie_str = "; ".join(f"{k}={v}" for k, v in seen.items())

    print()
    save_to_doppler(f"{prefix}_COOKIES", cookie_str)
    if bearer:
        save_to_doppler(f"{prefix}_BEARER_TOKEN", bearer)
    else:
        print(f"  WARNING: bearer token missing — set {prefix}_BEARER_TOKEN manually")
    if csrf:
        save_to_doppler(f"{prefix}_CSRF_TOKEN", csrf)
    else:
        print(f"  WARNING: CSRF token missing — set {prefix}_CSRF_TOKEN manually")
    if customer:
        save_to_doppler(f"{prefix}_CUSTOMER_ID", customer)
    else:
        print(f"  WARNING: customer ID missing — set {prefix}_CUSTOMER_ID manually")
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
