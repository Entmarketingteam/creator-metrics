"""
One-time script to extract Amazon Associates session cookies.

Run locally (not on Railway) so Amazon sees your real IP:
  cd sync-service
  pip install playwright pyotp
  python extract_amazon_cookies.py

Opens a real browser window. Log in normally (including 2FA if prompted).
Once you're on Associates Central, the script grabs the cookies and
saves them to Doppler automatically.
"""
import json
import subprocess
import time
from playwright.sync_api import sync_playwright

DOPPLER_PROJECT = "ent-agency-automation"
DOPPLER_CONFIG  = "dev"

COOKIE_NAMES = [
    "session-id",
    "session-token",
    "ubid-main",
    "x-main",
    "at-main",
    "sess-at-main",
    "csm-hit",
]

def save_to_doppler(key: str, value: str):
    result = subprocess.run(
        [
            "doppler", "secrets", "set", f"{key}={value}",
            "--project", DOPPLER_PROJECT,
            "--config", DOPPLER_CONFIG,
        ],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  ⚠️  Doppler error for {key}: {result.stderr.strip()}")
    else:
        print(f"  ✓  {key} saved to Doppler")

def main():
    print("Opening browser — log into Amazon Associates normally.")
    print("The script will detect when you're logged in and grab the cookies.\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,  # visible window so you can log in
            args=["--start-maximized"],
        )
        context = browser.new_context(
            viewport=None,  # use maximized window size
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        # Navigate directly to Associates Central — Amazon will show login form if needed
        page.goto("https://affiliate-program.amazon.com/home")

        print("Waiting for you to log in...")
        print("(Complete the login in the browser window that just opened)\n")
        # Poll until we land on Associates Central dashboard (not the login redirect)
        while True:
            time.sleep(3)
            try:
                url = page.url
                print(f"  url={url[:80]}")
                # Must be on affiliate-program.amazon.com (login pages are on www.amazon.com)
                on_associates = url.startswith("https://affiliate-program.amazon.com")
                if on_associates:
                    print(f"\n✓ Detected login complete (url={url[:60]})")
                    break
            except Exception:
                pass  # page navigating — retry next loop

        # Playwright context.cookies() returns ALL cookies including HttpOnly
        all_cookies = context.cookies("https://www.amazon.com")
        all_cookies += context.cookies("https://affiliate-program.amazon.com")

        found = {}
        for c in all_cookies:
            if c["name"] in COOKIE_NAMES and c["name"] not in found:
                found[c["name"]] = c["value"]

        browser.close()

    print(f"\nExtracted {len(found)} cookies: {list(found.keys())}\n")

    if not found:
        print("No cookies found — something went wrong.")
        return

    # Build cookie string for httpx (name=value; name=value)
    cookie_str = "; ".join(f"{k}={v}" for k, v in found.items())

    print("Saving to Doppler...")
    save_to_doppler("AMAZON_NICKI_COOKIES", cookie_str)

    # Also save individual cookies for debugging
    for name, value in found.items():
        env_key = "AMAZON_NICKI_" + name.upper().replace("-", "_")
        save_to_doppler(env_key, value)

    print("\nAll done! Cookie string also printed below for Railway:\n")
    print(f"AMAZON_NICKI_COOKIES={cookie_str}\n")
    print("Add it to Railway with:")
    print(f'  railway variables set AMAZON_NICKI_COOKIES="{cookie_str}"')

if __name__ == "__main__":
    main()
