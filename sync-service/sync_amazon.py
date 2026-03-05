"""
Amazon Associates sync — logs into affiliate-program.amazon.com for each creator,
intercepts the performance summary API, and writes earnings to platform_earnings.
Uses Airtop CDP + Playwright (same pattern as LTK).
"""
import os, json, logging, time
from datetime import datetime, timezone, date, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

AIRTOP_BASE = "https://api.airtop.ai/api/v1"

CREATORS = [
    {
        "id": "nicki_entenmann",
        "email_env": "LTK_EMAIL",         # marketingteam@nickient.com
        "password_env": "LTK_PASSWORD",
        "tag": "nickientenmann-20",
    },
    {
        "id": "annbschulte",
        "email_env": "ANN_AMAZON_EMAIL",
        "password_env": "ANN_AMAZON_PASSWORD",
        "tag": None,
    },
    {
        "id": "ellenludwigfitness",
        "email_env": "ELLEN_AMAZON_EMAIL",
        "password_env": "ELLEN_AMAZON_PASSWORD",
        "tag": None,
    },
    {
        "id": "livefitwithem",
        "email_env": "EMILY_AMAZON_EMAIL",
        "password_env": "EMILY_AMAZON_PASSWORD",
        "tag": None,
    },
]

# How many days of history to pull per sync
SYNC_DAYS = 30


def _airtop(airtop_key: str, method: str, path: str, body=None) -> dict:
    import urllib.request, urllib.error
    url = f"{AIRTOP_BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {airtop_key}",
        "Content-Type": "application/json",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=90)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Airtop {method} {path} → {e.code}: {e.read().decode()}")


def _cleanup_sessions(airtop_key: str):
    try:
        existing = _airtop(airtop_key, "GET", "/sessions")
        for s in existing.get("data", {}).get("sessions", []):
            try:
                _airtop(airtop_key, "DELETE", f"/sessions/{s['id']}")
            except Exception:
                pass
    except Exception as e:
        logger.warning("Could not clean up Airtop sessions: %s", e)


def _scrape_amazon_earnings(airtop_key: str, email: str, password: str, days: int) -> Optional[dict]:
    """
    Opens Amazon Associates Central, logs in, intercepts the performance
    summary API response. Returns dict with clicks, orders, revenue fields.
    """
    from playwright.sync_api import sync_playwright

    # Create session
    session = _airtop(airtop_key, "POST", "/sessions", {
        "configuration": {"timeoutMinutes": 8}
    })
    session_id = session["data"]["id"]

    # Wait for running
    for _ in range(20):
        status = _airtop(airtop_key, "GET", f"/sessions/{session_id}")["data"]["status"]
        if status == "running":
            break
        time.sleep(3)
    else:
        raise RuntimeError("Airtop session never became running")

    cdp_ws = _airtop(airtop_key, "GET", f"/sessions/{session_id}")["data"]["cdpWsUrl"]
    logger.info("Airtop session running for %s", email)

    intercepted = {}
    today = date.today()
    start_date = (today - timedelta(days=days)).strftime("%Y-%m-%d")
    end_date = today.strftime("%Y-%m-%d")

    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(
                cdp_ws,
                headers={"Authorization": f"Bearer {airtop_key}"}
            )
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()

            # Intercept Associates performance API responses
            def _on_response(response):
                url = response.url
                # Performance summary endpoints
                if any(x in url for x in [
                    "/home/api/default/performance",
                    "/associates/api",
                    "reporting/table",
                    "reporting/download",
                    "/home/summary",
                    "performanceSummary",
                    "commissionsSummary",
                ]):
                    try:
                        data = response.json()
                        logger.info("Captured API: %s → keys: %s", url[:80], list(data.keys()) if isinstance(data, dict) else type(data).__name__)
                        intercepted[url] = data
                    except Exception:
                        pass

            page.on("response", _on_response)

            # Navigate to Associates Central summary
            logger.info("Navigating to Associates Central for %s...", email)
            page.goto(
                "https://affiliate-program.amazon.com/home/summary",
                wait_until="domcontentloaded",
                timeout=30000,
            )
            time.sleep(2)

            # Check if we need to log in
            if "signin" in page.url or "ap/signin" in page.url or "ap/cvf" in page.url or "login" in page.url.lower():
                logger.info("Login required for %s", email)
                page.wait_for_selector('input[name="email"], input[type="email"], #ap_email', timeout=10000)

                # Fill email
                email_input = (
                    page.query_selector('input[name="email"]') or
                    page.query_selector('input[type="email"]') or
                    page.query_selector('#ap_email')
                )
                if email_input:
                    email_input.fill(email)

                # Click continue if present
                continue_btn = page.query_selector('input[id="continue"], #continue, [name="continue"]')
                if continue_btn:
                    continue_btn.click()
                    time.sleep(2)

                # Fill password
                page.wait_for_selector('input[name="password"], input[type="password"], #ap_password', timeout=10000)
                pw_input = (
                    page.query_selector('input[name="password"]') or
                    page.query_selector('input[type="password"]') or
                    page.query_selector('#ap_password')
                )
                if pw_input:
                    pw_input.fill(password)

                # Submit
                submit = (
                    page.query_selector('input[id="signInSubmit"]') or
                    page.query_selector('#signInSubmit') or
                    page.query_selector('[type="submit"]')
                )
                if submit:
                    submit.click()

                # Wait for post-login navigation
                page.wait_for_load_state("networkidle", timeout=20000)
                time.sleep(3)
                logger.info("Post-login URL: %s", page.url)

            # Navigate to performance reports to trigger API calls
            page.goto(
                f"https://affiliate-program.amazon.com/home/reports/table?dateRangeValue=custom"
                f"&startDate={start_date}&endDate={end_date}&type=earning",
                wait_until="domcontentloaded",
                timeout=30000,
            )
            page.wait_for_load_state("networkidle", timeout=15000)
            time.sleep(3)

            # Also try summary page
            page.goto(
                "https://affiliate-program.amazon.com/home/summary",
                wait_until="domcontentloaded",
                timeout=20000,
            )
            page.wait_for_load_state("networkidle", timeout=10000)
            time.sleep(2)

            # Try to extract data from the page directly via JS
            page_data = page.evaluate("""
                () => {
                    // Try to find summary widgets on the page
                    const text = document.body.innerText;
                    const result = { raw_text: text.substring(0, 3000), found: {} };

                    // Look for earning summary elements
                    const earningEls = document.querySelectorAll('[data-summary-type], .earnings-summary, .summary-widget');
                    earningEls.forEach(el => {
                        result.found[el.className || el.dataset.summaryType] = el.innerText;
                    });
                    return result;
                }
            """)

            logger.info("Page URL after scraping: %s", page.url)
            logger.info("Intercepted %d API responses", len(intercepted))

            browser.close()

    finally:
        try:
            _airtop(airtop_key, "DELETE", f"/sessions/{session_id}")
        except Exception:
            pass

    return {
        "intercepted": intercepted,
        "page_data": page_data,
        "start_date": start_date,
        "end_date": end_date,
    }


def _parse_earnings(raw: dict) -> Optional[dict]:
    """
    Parse intercepted API responses into standardized earnings dict.
    Returns: { revenue, commission, clicks, orders }
    """
    intercepted = raw.get("intercepted", {})
    page_data = raw.get("page_data", {})

    # Try each intercepted API response
    for url, data in intercepted.items():
        if not isinstance(data, dict):
            continue

        result = {}

        # Pattern 1: { clicks, orders/conversions, earnings/revenue/commission }
        clicks = (data.get("clicks") or data.get("totalClicks") or
                  data.get("click_count") or data.get("clickCount"))
        orders = (data.get("orders") or data.get("conversions") or
                  data.get("orderedItems") or data.get("ordered_items") or
                  data.get("itemsShipped"))
        revenue = (data.get("revenue") or data.get("earnings") or
                   data.get("estimatedRevenue") or data.get("totalRevenue") or
                   data.get("commissions") or data.get("commission"))

        if clicks is not None or orders is not None or revenue is not None:
            return {
                "clicks": int(clicks) if clicks is not None else 0,
                "orders": int(orders) if orders is not None else 0,
                "revenue": float(revenue) if revenue is not None else 0.0,
                "commission": float(revenue) if revenue is not None else 0.0,
            }

        # Pattern 2: nested data
        for key in ["data", "summary", "performance", "report"]:
            nested = data.get(key)
            if isinstance(nested, dict):
                clicks = (nested.get("clicks") or nested.get("totalClicks") or
                          nested.get("clickCount"))
                orders = (nested.get("orders") or nested.get("conversions") or
                          nested.get("orderedItems"))
                revenue = (nested.get("revenue") or nested.get("earnings") or
                           nested.get("estimatedRevenue") or nested.get("commissions"))
                if clicks is not None or orders is not None or revenue is not None:
                    return {
                        "clicks": int(clicks) if clicks is not None else 0,
                        "orders": int(orders) if orders is not None else 0,
                        "revenue": float(revenue) if revenue is not None else 0.0,
                        "commission": float(revenue) if revenue is not None else 0.0,
                    }

    # Fallback: parse page text for dollar amounts and numbers
    raw_text = page_data.get("raw_text", "")
    if raw_text:
        import re
        # Find earnings amounts like $12.34
        amounts = re.findall(r'\$([0-9,]+\.[0-9]{2})', raw_text)
        numbers = re.findall(r'([0-9,]+)\s+(?:clicks?|Clicks?)', raw_text)
        orders_match = re.findall(r'([0-9,]+)\s+(?:orders?|Orders?|conversions?)', raw_text)

        if amounts:
            # Largest amount is likely total earnings
            parsed_amounts = sorted([float(a.replace(',', '')) for a in amounts], reverse=True)
            clicks_val = int(numbers[0].replace(',', '')) if numbers else 0
            orders_val = int(orders_match[0].replace(',', '')) if orders_match else 0
            return {
                "clicks": clicks_val,
                "orders": orders_val,
                "revenue": parsed_amounts[0],
                "commission": parsed_amounts[0],
            }

    return None


def sync_amazon(conn) -> dict:
    """
    Main entry point. Called by Railway sync service.
    Syncs Amazon Associates earnings for all configured creators.
    """
    airtop_key = os.environ.get("AIRTOP_API_KEY")
    if not airtop_key:
        raise RuntimeError("AIRTOP_API_KEY not set")

    # Clean up stale Airtop sessions first
    _cleanup_sessions(airtop_key)

    today = date.today()
    period_start = (today - timedelta(days=SYNC_DAYS)).isoformat()
    period_end = today.isoformat()
    synced_at = datetime.now(timezone.utc).isoformat()

    results = []

    for creator in CREATORS:
        creator_id = creator["id"]
        email = os.environ.get(creator["email_env"])
        password = os.environ.get(creator["password_env"])

        if not email or not password:
            logger.warning("No credentials for %s (missing %s/%s), skipping",
                           creator_id, creator["email_env"], creator["password_env"])
            results.append({"creator": creator_id, "status": "skipped", "reason": "no credentials"})
            continue

        logger.info("=== Syncing Amazon for %s (%s) ===", creator_id, email)
        try:
            raw = _scrape_amazon_earnings(airtop_key, email, password, SYNC_DAYS)
            earnings = _parse_earnings(raw)

            if earnings:
                logger.info("Parsed earnings for %s: %s", creator_id, earnings)
                conn.execute("""
                    INSERT INTO platform_earnings
                        (creator_id, platform, period_start, period_end,
                         revenue, commission, clicks, orders, synced_at)
                    VALUES ($1, 'amazon', $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (creator_id, platform, period_start, period_end)
                    DO UPDATE SET
                        revenue = EXCLUDED.revenue,
                        commission = EXCLUDED.commission,
                        clicks = EXCLUDED.clicks,
                        orders = EXCLUDED.orders,
                        synced_at = EXCLUDED.synced_at
                """,
                    creator_id,
                    period_start,
                    period_end,
                    str(earnings["revenue"]),
                    str(earnings["commission"]),
                    earnings["clicks"],
                    earnings["orders"],
                    synced_at,
                )
                results.append({
                    "creator": creator_id,
                    "status": "ok",
                    "clicks": earnings["clicks"],
                    "orders": earnings["orders"],
                    "commission": earnings["commission"],
                })
            else:
                logger.warning("No earnings data extracted for %s. Intercepted URLs: %s",
                               creator_id, list(raw.get("intercepted", {}).keys()))
                results.append({
                    "creator": creator_id,
                    "status": "no_data",
                    "intercepted_count": len(raw.get("intercepted", {})),
                })

        except Exception as e:
            logger.error("Amazon sync failed for %s: %s", creator_id, e, exc_info=True)
            results.append({"creator": creator_id, "status": "error", "error": str(e)})

        # Brief pause between creators to avoid session conflicts
        time.sleep(5)

    return {"synced": synced_at, "results": results}
