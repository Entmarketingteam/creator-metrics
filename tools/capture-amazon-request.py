#!/usr/bin/env python3
"""
Intercepts the real /reporting/summary request from Chrome and saves
exact headers + cookies to Doppler using JSON file upload.
Run this before amazon-data-sync.py to refresh short-lived credentials.
"""
import sys
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import json
import os
import subprocess
import tempfile
import time
import urllib.request

CDP_URL = "http://127.0.0.1:9222"
DOPPLER_PROJECT = "ent-agency-analytics"
DOPPLER_CONFIG = "prd"
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PROFILE_DIR = r"C:\Users\ethan.atchley\AppData\Local\creator-metrics\amz-debug"


def cdp_ready():
    try:
        urllib.request.urlopen(f"{CDP_URL}/json/version", timeout=2)
        return True
    except Exception:
        return False


def save_secrets_to_doppler(secrets: dict):
    with tempfile.NamedTemporaryFile(
        mode='w', suffix='.json', delete=False, encoding='utf-8'
    ) as f:
        json.dump(secrets, f, ensure_ascii=False)
        tmp = f.name
    r = subprocess.run(
        ["doppler", "secrets", "upload", tmp,
         "--project", DOPPLER_PROJECT, "--config", DOPPLER_CONFIG],
        capture_output=True,
    )
    os.unlink(tmp)
    if r.returncode == 0:
        for k, v in secrets.items():
            print(f"  OK {k} ({len(v)} chars)")
        return True
    print(f"  ERROR: {r.stderr.decode(errors='replace')[:300]}")
    return False


def main():
    if not cdp_ready():
        print("Launching Chrome...")
        subprocess.Popen([
            CHROME_PATH, "--remote-debugging-port=9222",
            f"--user-data-dir={PROFILE_DIR}", "--no-first-run",
            "https://affiliate-program.amazon.com/p/reporting/earnings",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            time.sleep(1)
            print(".", end="", flush=True)
            if cdp_ready():
                print(" ready.\n")
                break
    else:
        print("Chrome already running.\n")

    from playwright.sync_api import sync_playwright

    captured = {}

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP_URL)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()

        pg = None
        for tab in ctx.pages:
            if "affiliate-program.amazon.com" in tab.url:
                pg = tab
                break
        if pg is None:
            pg = ctx.new_page()

        # Use CDP Network domain for deep request interception (catches SW-bypassed requests)
        cdp = ctx.new_cdp_session(pg)
        cdp.send("Network.enable")
        cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})

        def on_cdp_request(params):
            url = params.get("request", {}).get("url", "")
            if "/reporting/summary" in url and not captured:
                captured.update(params["request"].get("headers", {}))
                captured["_url"] = url
                print(f"Intercepted: {url[:80]}")

        cdp.on("Network.requestWillBeSent", on_cdp_request)

        # Also Playwright-level fallback
        def on_request(req):
            if "/reporting/summary" in req.url and not captured:
                captured.update(req.headers)
                captured["_url"] = req.url
                print(f"Intercepted (pw): {req.url[:80]}")

        pg.on("request", on_request)

        # Unregister Service Workers so they can't serve cached responses
        try:
            pg.evaluate("""async () => {
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for (const r of regs) await r.unregister();
                }
            }""")
        except Exception:
            pass

        print("Ensuring on earnings page...")
        if "affiliate-program.amazon.com" not in pg.url:
            pg.goto("https://affiliate-program.amazon.com/p/reporting/earnings",
                    wait_until="networkidle", timeout=30000)
            time.sleep(3)

        # CDP hard reload (ignoreCache=True = Ctrl+Shift+R, bypasses Service Worker)
        for attempt in range(3):
            if captured:
                break
            print(f"Hard reload attempt {attempt + 1} (ignoreCache)...")
            cdp.send("Page.reload", {"ignoreCache": True})
            pg.wait_for_load_state("networkidle", timeout=30000)
            for _ in range(15):
                if captured:
                    break
                time.sleep(1)

        # Get all cookies via CDP
        all_cookies = cdp.send("Network.getAllCookies").get("cookies", [])
        browser.close()

    if not captured:
        print("ERROR: Could not intercept /reporting/summary after 3 reloads.")
        print("Make sure Chrome is logged into affiliate-program.amazon.com.")
        sys.exit(1)

    print(f"\nCaptured: {captured.get('_url', '')[:90]}")
    print(f"Cookies: {len(all_cookies)}")
    for k in ["x-csrf-token", "customerid", "marketplaceid", "storeid", "authorization"]:
        v = captured.get(k, "")
        if v:
            print(f"  {k}: {v[:60]}{'...' if len(v) > 60 else ''}")

    seen = {}
    for c in all_cookies:
        if c["name"] not in seen:
            seen[c["name"]] = c["value"]
    cookie_str = "; ".join(f"{k}={v}" for k, v in seen.items())

    secrets = {"AMAZON_NICKI_COOKIES": cookie_str}
    if captured.get("x-csrf-token"):
        secrets["AMAZON_NICKI_CSRF_TOKEN"] = captured["x-csrf-token"]
    if captured.get("customerid"):
        secrets["AMAZON_NICKI_CUSTOMER_ID"] = captured["customerid"]
    if captured.get("marketplaceid"):
        secrets["AMAZON_NICKI_MARKETPLACE_ID"] = captured["marketplaceid"]
    if captured.get("authorization", "").startswith("Bearer "):
        secrets["AMAZON_NICKI_BEARER_TOKEN"] = captured["authorization"][7:]

    print(f"\nSaving {len(secrets)} secrets to Doppler...")
    return save_secrets_to_doppler(secrets)


if __name__ == "__main__":
    if not main():
        sys.exit(1)
