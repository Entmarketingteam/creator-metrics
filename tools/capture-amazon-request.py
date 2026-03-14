#!/usr/bin/env python3
"""
Intercepts the real /reporting/summary request from Chrome and saves
exact headers + cookies to Doppler using JSON file upload (avoids Windows encoding issues).
"""
import json
import os
import subprocess
import sys
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
    """Upload all secrets at once via JSON file — avoids Windows cp1252 encoding issues."""
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
            print(f"  ✅ {k} ({len(v)} chars)")
    else:
        err = r.stderr.decode(errors='replace')
        print(f"  ❌ Upload failed: {err[:300]}")
        return False
    return True


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
    print("Chrome already running with debug port.\n")

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

    def on_request(req):
        if "/reporting/summary" in req.url and not captured:
            captured.update(req.headers)
            captured["_url"] = req.url
            print(f"✅ Intercepted: {req.url[:90]}")

    pg.on("request", on_request)

    print(f"Current page: {pg.url}")
    print("Navigating to earnings page...")
    pg.goto("https://affiliate-program.amazon.com/p/reporting/earnings",
            wait_until="domcontentloaded", timeout=30000)

    for i in range(20):
        if captured:
            break
        time.sleep(1)

    if not captured:
        print("No request yet — reloading...")
        pg.reload(wait_until="networkidle", timeout=20000)
        for i in range(10):
            if captured:
                break
            time.sleep(1)

    # Get all cookies via CDP
    cdp_session = ctx.new_cdp_session(pg)
    all_cookies = cdp_session.send("Network.getAllCookies").get("cookies", [])
    browser.close()

if not captured:
    print("❌ Could not intercept /reporting/summary request.")
    sys.exit(1)

print(f"\nIntercepted from: {captured.get('_url', '')[:90]}")
print(f"Cookies captured: {len(all_cookies)}")

# Print what we found
for k in ["x-csrf-token", "customerid", "marketplaceid", "storeid", "authorization"]:
    v = captured.get(k, "")
    if v:
        print(f"  {k}: {v[:70]}{'...' if len(v) > 70 else ''}")

# Build cookie string (deduplicated)
seen = {}
for c in all_cookies:
    if c["name"] not in seen:
        seen[c["name"]] = c["value"]
cookie_str = "; ".join(f"{k}={v}" for k, v in seen.items())

# Build secrets dict
secrets = {
    "AMAZON_NICKI_COOKIES": cookie_str,
}
if captured.get("x-csrf-token"):
    secrets["AMAZON_NICKI_CSRF_TOKEN"] = captured["x-csrf-token"]
if captured.get("customerid"):
    secrets["AMAZON_NICKI_CUSTOMER_ID"] = captured["customerid"]
if captured.get("marketplaceid"):
    secrets["AMAZON_NICKI_MARKETPLACE_ID"] = captured["marketplaceid"]
if captured.get("authorization", "").startswith("Bearer "):
    secrets["AMAZON_NICKI_BEARER_TOKEN"] = captured["authorization"][7:]

print(f"\nSaving {len(secrets)} secrets to Doppler...")
if save_secrets_to_doppler(secrets):
    print("\nDone! Now run:")
    print("  python3 tools/debug-amazon-auth.py")
