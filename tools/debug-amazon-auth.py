#!/usr/bin/env python3
"""Debug Amazon Associates auth — prints headers and response body."""
import json
import subprocess
import urllib.request
import urllib.parse


def get_secret(key, project="ent-agency-analytics", config="prd"):
    r = subprocess.run(
        ["doppler", "secrets", "get", key, "--project", project, "--config", config, "--plain"],
        capture_output=True,
    )
    return r.stdout.decode('utf-8', errors='replace').strip()


cookies = get_secret("AMAZON_NICKI_COOKIES")
csrf    = get_secret("AMAZON_NICKI_CSRF_TOKEN")
bearer  = get_secret("AMAZON_NICKI_BEARER_TOKEN")
customer = get_secret("AMAZON_NICKI_CUSTOMER_ID")
mkt     = get_secret("AMAZON_NICKI_MARKETPLACE_ID") or "ATVPDKIKX0DER"
tag     = "nickientenman-20"

print(f"cookies  : {len(cookies)} chars — {cookies[:60]}...")
print(f"csrf     : {csrf[:40]}..." if csrf else "csrf     : MISSING")
print(f"bearer   : {'OK (' + str(len(bearer)) + ' chars)' if bearer else 'MISSING'}")
print(f"customer : {customer or 'MISSING'}")
print(f"mkt      : {mkt}")
print(f"tag      : {tag}")
print()

headers = {
    "Cookie": cookies,
    "X-Csrf-Token": csrf,
    "X-Requested-With": "XMLHttpRequest",
    "customerid": customer,
    "marketplaceid": mkt,
    "programid": "1",
    "roles": "Primary",
    "storeid": tag,
    "language": "en_US",
    "locale": "en_US",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://affiliate-program.amazon.com/",
}
if bearer:
    headers["Authorization"] = f"Bearer {bearer}"

params = urllib.parse.urlencode({
    "query[start_date]": "2026-02-01",
    "query[end_date]": "2026-02-28",
    "query[type]": "earning",
    "store_id": tag,
})
url = f"https://affiliate-program.amazon.com/reporting/summary?{params}"
print(f"GET {url}\n")

try:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode()
        print(f"HTTP {resp.status}")
        print(json.dumps(json.loads(body), indent=2)[:1000])
except urllib.error.HTTPError as e:
    body = e.read().decode(errors="replace")
    print(f"HTTP {e.code}: {body[:500]}")
