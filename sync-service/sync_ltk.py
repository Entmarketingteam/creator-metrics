"""
LTK sync — token refresh (Playwright via Airtop) + data sync to Supabase.
"""
import os, json, logging
from datetime import datetime, timezone, timedelta
import httpx

logger = logging.getLogger(__name__)

AIRTOP_BASE   = "https://api.airtop.ai/api/v1"
AIRTABLE_URL  = "https://api.airtable.com/v0"
LTK_GATEWAY   = "https://api-gateway.rewardstyle.com"
LTK_HEADERS   = {
    "Origin": "https://creator.shopltk.com",
    "Referer": "https://creator.shopltk.com/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
}


# ── Airtable helpers ────────────────────────────────────────────────────────

def _airtable_headers():
    return {"Authorization": f"Bearer {os.environ['AIRTABLE_TOKEN']}",
            "Content-Type": "application/json"}

def get_ltk_tokens_from_airtable() -> dict:
    base_id = os.environ["AIRTABLE_BASE_ID"]
    url = (f"{AIRTABLE_URL}/{base_id}/LTK_Credentials"
           "?maxRecords=1&sort%5B0%5D%5Bfield%5D=Last_Refreshed"
           "&sort%5B0%5D%5Bdirection%5D=desc")
    r = httpx.get(url, headers=_airtable_headers(), timeout=30)
    r.raise_for_status()
    records = r.json().get("records", [])
    if not records:
        raise RuntimeError("No LTK credentials found in Airtable")
    f = records[0]["fields"]
    return {
        "access_token": f["Access_Token"],
        "id_token": f["ID_Token"],
        "record_id": records[0]["id"],
        "publisher_id": f.get("Publisher_ID", "293045"),
    }

def update_ltk_tokens_in_airtable(record_id: str, access_token: str, id_token: str, refresh_token: str):
    import base64
    # Decode expiry from JWT
    payload = access_token.split(".")[1]
    pad = 4 - len(payload) % 4
    data = json.loads(base64.urlsafe_b64decode(payload + "=" * pad))
    expires_at = datetime.utcfromtimestamp(data["exp"]).isoformat() + "Z"

    base_id = os.environ["AIRTABLE_BASE_ID"]
    url = f"{AIRTABLE_URL}/{base_id}/LTK_Credentials/{record_id}"
    fields = {
        "Access_Token": access_token,
        "ID_Token": id_token,
        "Refresh_Token": refresh_token,
        "Last_Refreshed": datetime.now(timezone.utc).isoformat(),
        "Token_Expires_At": expires_at,
        "Status": "active",
        "Consecutive_Failures": 0,
    }
    r = httpx.patch(url, json={"fields": fields}, headers=_airtable_headers(), timeout=30)
    r.raise_for_status()
    logger.info("LTK tokens updated in Airtable, expires %s", expires_at)


# ── Token refresh via Airtop ────────────────────────────────────────────────

def refresh_ltk_tokens():
    """
    Uses the Airtop browser automation API to log into shopltk.com and
    extract fresh Auth0 tokens from localStorage. Writes back to Airtable.
    """
    import urllib.request
    import urllib.error
    airtop_key = os.environ["AIRTOP_API_KEY"]
    ltk_email  = os.environ["LTK_EMAIL"]
    ltk_password = os.environ["LTK_PASSWORD"]

    def airtop(method, path, body=None):
        url = f"{AIRTOP_BASE}{path}"
        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {airtop_key}",
            "Content-Type": "application/json",
        })
        try:
            resp = urllib.request.urlopen(req, timeout=60)
            return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Airtop {method} {path} → {e.code}: {e.read().decode()}")

    # Terminate any existing sessions to avoid hitting the free plan 3-session limit
    logger.info("Cleaning up stale Airtop sessions...")
    try:
        existing_sessions = airtop("GET", "/sessions")
        for s in existing_sessions.get("data", {}).get("sessions", []):
            try:
                airtop("DELETE", f"/sessions/{s['id']}")
                logger.info("Terminated stale Airtop session %s", s["id"])
            except Exception:
                pass
    except Exception as e:
        logger.warning("Could not list/clean Airtop sessions: %s", e)

    logger.info("Creating Airtop session for LTK token refresh...")
    session = airtop("POST", "/sessions", {"configuration": {"timeoutMinutes": 5}})
    session_id = session["data"]["id"]

    import time
    for _ in range(15):
        status = airtop("GET", f"/sessions/{session_id}")["data"]["status"]
        if status == "running":
            break
        time.sleep(2)
    else:
        raise RuntimeError("Airtop session never reached running state")

    window = airtop("POST", f"/sessions/{session_id}/windows", {
        "url": "https://creator.shopltk.com/login"
    })
    cdp_ws = session["data"].get("cdpWsUrl") or airtop("GET", f"/sessions/{session_id}")["data"]["cdpWsUrl"]
    logger.info("Airtop session running, connecting via Playwright CDP")

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(
            cdp_ws,
            headers={"Authorization": f"Bearer {airtop_key}"}
        )
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.new_page()

        # Intercept /oauth/token response to capture id_token before Auth0 SDK processes it
        intercepted_tokens = {}
        def _on_response(response):
            if "/oauth/token" in response.url and response.status == 200:
                try:
                    data = response.json()
                    if "id_token" in data:
                        intercepted_tokens["id_token"] = data["id_token"]
                    if "access_token" in data:
                        intercepted_tokens["access_token"] = data["access_token"]
                    if "refresh_token" in data:
                        intercepted_tokens["refresh_token"] = data["refresh_token"]
                    logger.info("Intercepted /oauth/token response keys: %s", list(data.keys()))
                except Exception as e:
                    logger.warning("Could not parse /oauth/token response: %s", e)
        page.on("response", _on_response)

        page.goto("https://creator.shopltk.com/login", wait_until="domcontentloaded", timeout=30000)
        # Wait for email input to be present and stable before querying
        page.wait_for_selector('input[type="email"], input[type="text"]', timeout=15000)
        # Fill credentials
        inputs = page.query_selector_all('input[type="email"], input[type="text"], input[type="password"]')
        email_input = next((i for i in inputs if i.get_attribute("type") in ("email", "text")), None)
        pw_input    = next((i for i in inputs if i.get_attribute("type") == "password"), None)
        if not email_input or not pw_input:
            raise RuntimeError("Could not find login form fields")
        email_input.fill(ltk_email)
        pw_input.fill(ltk_password)
        page.click('button[type="submit"]')
        page.wait_for_url("https://creator.shopltk.com/**", timeout=20000)

        # Wait for Auth0 to write tokens to localStorage after redirect
        page.wait_for_timeout(4000)

        # Debug: log all localStorage keys and the raw auth0 value
        all_keys = page.evaluate("() => Object.keys(localStorage)")
        logger.info("localStorage keys after login: %s", all_keys)
        auth0_keys = [k for k in (all_keys or []) if "@@auth0spajs@@" in k]
        logger.info("Auth0 localStorage keys: %s", auth0_keys)
        logger.info("Intercepted token keys: %s", list(intercepted_tokens.keys()))

        # Extract tokens from localStorage first, fall back to intercepted network response
        raw = page.evaluate("""() => {
            const key = Object.keys(localStorage).find(k => k.includes('@@auth0spajs@@'));
            return key ? localStorage.getItem(key) : null;
        }""")

        access_token = refresh_token = id_token = None

        if raw:
            try:
                auth0 = json.loads(raw)
                body = auth0.get("body", {})
                access_token  = body.get("access_token")
                id_token      = body.get("id_token")
                refresh_token = body.get("refresh_token", "")
                logger.info("localStorage body keys: %s", list(body.keys()))
            except Exception as e:
                logger.warning("Could not parse auth0 localStorage: %s", e)

        # Fall back to intercepted network response for any missing tokens
        if not access_token:
            access_token = intercepted_tokens.get("access_token")
        if not id_token:
            id_token = intercepted_tokens.get("id_token")
        if not refresh_token:
            refresh_token = intercepted_tokens.get("refresh_token", "")

        if not access_token:
            raise RuntimeError(
                f"Missing access_token. "
                f"localStorage body keys: {list(body.keys()) if raw else 'N/A'}, "
                f"intercepted keys: {list(intercepted_tokens.keys())}"
            )
        # Auth0 may not issue a separate id_token — fall back to access_token
        if not id_token:
            id_token = access_token
            logger.info("No id_token from Auth0 — using access_token as id_token fallback")

        browser.close()

    # Terminate Airtop session
    try:
        airtop("DELETE", f"/sessions/{session_id}")
    except Exception:
        pass

    # Write to Airtable
    existing = get_ltk_tokens_from_airtable()
    update_ltk_tokens_in_airtable(
        existing["record_id"], access_token, id_token, refresh_token
    )
    logger.info("LTK token refresh complete")
    return {"status": "ok", "expires_in_hours": 1}


# ── LTK data sync ────────────────────────────────────────────────────────────

def _ltk_headers(tokens: dict) -> dict:
    return {
        "Authorization": f"Bearer {tokens['access_token']}",
        "x-id-token": tokens["id_token"],
        "Content-Type": "application/json",
        **LTK_HEADERS,
    }

def sync_ltk_data(conn) -> dict:
    """
    Fetch LTK commissions + performance stats and upsert into platform_earnings.
    Uses tokens from Airtable. Syncs 7d and 30d windows.
    """
    tokens = get_ltk_tokens_from_airtable()
    publisher_id = str(tokens["publisher_id"])

    # Fetch commissions summary (lifetime/open earnings)
    with httpx.Client(timeout=30) as client:
        comm_res = client.get(
            f"{LTK_GATEWAY}/api/creator-analytics/v1/commissions_summary?currency=USD",
            headers=_ltk_headers(tokens)
        )
        comm_res.raise_for_status()
        commissions = comm_res.json().get("commissions_summary", {})

    results = []
    now = datetime.utcnow()

    for days in [7, 30]:
        period_start      = (now - timedelta(days=days)).strftime("%Y-%m-%d")
        period_end        = now.strftime("%Y-%m-%d")
        period_start_date = (now - timedelta(days=days)).date()
        period_end_date   = now.date()

        params = {
            "start_date": f"{period_start}T00:00:00Z",
            "end_date":   f"{period_end}T23:59:59Z",
            "publisher_ids": publisher_id,
            "platform": "rs,ltk",
            "timezone": "UTC",
        }
        with httpx.Client(timeout=30) as client:
            perf_res = client.get(
                f"{LTK_GATEWAY}/api/creator-analytics/v1/performance_summary",
                params=params,
                headers=_ltk_headers(tokens)
            )
            perf_res.raise_for_status()
            perf = perf_res.json().get("data", {})

        open_earnings = str(commissions.get("open_earnings", 0))
        net_comm      = str(perf.get("net_commissions", commissions.get("open_earnings", 0)))
        clicks        = int(perf.get("clicks", 0))
        orders        = int(perf.get("orders", 0))

        conn.execute("""
            INSERT INTO platform_earnings
              (creator_id, platform, period_start, period_end, revenue, commission, clicks, orders, synced_at)
            VALUES ($1, 'ltk', $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (creator_id, platform, period_start, period_end)
            DO UPDATE SET revenue=$4, commission=$5, clicks=$6, orders=$7, synced_at=NOW()
        """, "nicki_entenmann", period_start_date, period_end_date, net_comm, open_earnings, clicks, orders)

        results.append({"range": f"last_{days}_days", "clicks": clicks, "orders": orders})

    logger.info("LTK data synced: %s", results)
    return {"status": "ok", "results": results}
