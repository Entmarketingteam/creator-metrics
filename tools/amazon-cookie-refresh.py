#!/usr/bin/env python3
"""
Amazon Associates Cookie Refresh
==================================
Uses a persistent Chromium profile (separate from your regular Chrome).
First run: you log in once. After that: no login needed (session is saved).

Usage:
    python3 tools/amazon-cookie-refresh.py             # default: nicki
    python3 tools/amazon-cookie-refresh.py --creator nicki
"""

import argparse
import re
import subprocess
import sys
import time
import os

from playwright.sync_api import sync_playwright

DOPPLER_PROJECT = "ent-agency-analytics"
DOPPLER_CONFIG = "prd"

CREATORS = {
    "nicki": {"tag": "nickientenman-20"},
    "ann":   {"tag": "annschulte-20"},
    "ellen": {"tag": "ellenludwig-20"},
    "emily": {"tag": "livefitwithem-20"},
}

# Persistent profile — saved between runs so you only log in once
PROFILE_DIR = os.path.expandvars(r"%LOCALAPPDATA%\creator-metrics\amz-profile")


def save_to_doppler(key: str, value: str):
    result = subprocess.run(
        ["doppler", "secrets", "set", f"{key}={value}",
         "--project", DOPPLER_PROJECT, "--config", DOPPLER_CONFIG],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  WARNING  Doppler error for {key}: {result.stderr.strip()}")
    else:
        print(f"  OK  {key} saved")


def extract_token(html: str):
    for pattern in [
        r'"associateIdentityToken"\s*:\s*"([^"]+)"',
        r"associateIdentityToken['\"]?\s*:\s*['\"]([^'\"]+)['\"]",
        r'"identityToken"\s*:\s*"([^"]+)"',
    ]:
        m = re.search(pattern, html)
        if m:
            return m.group(1)
    return None


def extract_csrf(html: str):
    for pattern in [
        r'<meta\s+name="csrf-token"\s+content="([^"]+)"',
        r'<meta\s+content="([^"]+)"\s+name="csrf-token"',
        r'"csrf[-_]token"\s*:\s*"([^"]+)"',
        r"csrfToken\s*[=:]\s*['\"]([^'\"]+)['\"]",
    ]:
        m = re.search(pattern, html)
        if m:
            return m.group(1)
    return None


def extract_customer_id(html: str):
    for pattern in [
        r'"customerId"\s*:\s*"([A-Z0-9]+)"',
        r'"customer_id"\s*:\s*"([A-Z0-9]+)"',
        r'"associateId"\s*:\s*"([A-Z0-9]+)"',
        r'data-customer-id="([A-Z0-9]+)"',
    ]:
        m = re.search(pattern, html)
        if m:
            return m.group(1)
    return None


def run_for_creator(creator: str):
    if creator not in CREATORS:
        print(f"Unknown creator: {creator}. Options: {', '.join(CREATORS)}")
        sys.exit(1)

    prefix = f"AMAZON_{creator.upper()}"

    print(f"\n{'='*60}")
    print(f"  Amazon Cookie Refresh: {creator}")
    print(f"{'='*60}")
    print(f"\n  Profile: {PROFILE_DIR}")
    if os.path.exists(PROFILE_DIR):
        print("  (existing session — may not need login)")
    else:
        print("  (new profile — login required this one time)")
    print()
    print("  *** USE THE CHROMIUM WINDOW THAT OPENS ***")
    print("  *** NOT your regular Chrome browser    ***\n")
    sys.stdout.flush()

    os.makedirs(PROFILE_DIR, exist_ok=True)

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            args=[
                "--start-maximized",
                "--disable-blink-features=AutomationControlled",
                "--disable-web-security",
            ],
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            no_viewport=True,
        )

        page = context.new_page()
        page.goto("https://affiliate-program.amazon.com/home/reports",
                  wait_until="domcontentloaded")

        # Wait for Associates Central across all tabs
        target_page = None
        print("Waiting for Associates Central...", flush=True)
        while target_page is None:
            time.sleep(2)
            for pg in context.pages:
                path = pg.url.split("?")[0]
                print(f"  {path[:80]}", flush=True)
                if (path.startswith("https://affiliate-program.amazon.com")
                        and "signin" not in path):
                    target_page = pg
                    print("  -> Associates Central detected!", flush=True)
                    break

        time.sleep(2)
        target_page.wait_for_load_state("domcontentloaded", timeout=15000)

        html = target_page.content()
        bearer = extract_token(html)
        csrf = extract_csrf(html)
        customer_id = extract_customer_id(html)

        if not bearer:
            bearer = target_page.evaluate("""() => {
                try {
                    const s = JSON.stringify(window.__AA_BOOTSTRAP__ || {});
                    const m = s.match(/"associateIdentityToken":"([^"]+)"/);
                    return m ? m[1] : null;
                } catch(e) { return null; }
            }""")

        if not csrf:
            csrf = target_page.evaluate("""() => {
                const m = document.querySelector('meta[name="csrf-token"]');
                return m ? m.getAttribute('content') : null;
            }""")

        if not customer_id:
            customer_id = target_page.evaluate("""() => {
                try {
                    const s = JSON.stringify(window.__AA_BOOTSTRAP__ || {});
                    const m = s.match(/"customerId":"([A-Z0-9]+)"/);
                    return m ? m[1] : null;
                } catch(e) { return null; }
            }""")

        all_cookies = (
            context.cookies("https://www.amazon.com")
            + context.cookies("https://affiliate-program.amazon.com")
        )
        context.close()

    print(f"\nExtracted:")
    print(f"  bearer  : {'OK (' + str(len(bearer)) + ' chars)' if bearer else 'MISSING'}")
    print(f"  csrf    : {'OK' if csrf else 'MISSING'}")
    print(f"  customer: {customer_id or 'MISSING'}")
    print(f"  cookies : {len(all_cookies)} total")

    if not all_cookies:
        print("\nERROR: No cookies extracted")
        sys.exit(1)

    seen = {}
    for c in all_cookies:
        if c["name"] not in seen:
            seen[c["name"]] = c["value"]
    cookie_str = "; ".join(f"{k}={v}" for k, v in seen.items())

    save_to_doppler(f"{prefix}_COOKIES", cookie_str)
    print(f"  Cookies: {len(seen)} unique cookies saved")

    if bearer:
        save_to_doppler(f"{prefix}_BEARER_TOKEN", bearer)
    else:
        print("  WARNING: Bearer token not found")

    if csrf:
        save_to_doppler(f"{prefix}_CSRF_TOKEN", csrf)
    else:
        print("  WARNING: CSRF token not found")

    if customer_id:
        save_to_doppler(f"{prefix}_CUSTOMER_ID", customer_id)
    else:
        print("  WARNING: Customer ID not found")

    save_to_doppler(f"{prefix}_MARKETPLACE_ID", "ATVPDKIKX0DER")

    print(f"\nAll done! Session saved to profile — next run won't need login.")
    print(f"Now run:")
    print(f"  python3 tools/amazon-data-sync.py --creator {creator} --dry-run")


def main():
    parser = argparse.ArgumentParser(description="Refresh Amazon Associates cookies")
    parser.add_argument("--creator", default="nicki", choices=list(CREATORS))
    args = parser.parse_args()
    run_for_creator(args.creator)


if __name__ == "__main__":
    main()
