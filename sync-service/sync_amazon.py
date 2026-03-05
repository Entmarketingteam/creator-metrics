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

    # Derive a stable profile name per Amazon account so cookies persist between runs
    import hashlib
    profile_name = "amazon-" + hashlib.md5(email.encode()).hexdigest()[:8]
    logger.info("Using Airtop profile: %s", profile_name)

    # Create session with persistent profile (saves Amazon session cookies)
    session = _airtop(airtop_key, "POST", "/sessions", {
        "configuration": {"timeoutMinutes": 10},
        "profileName": profile_name,
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

    today = date.today()
    start_date = (today - timedelta(days=days)).strftime("%Y-%m-%d")
    end_date = today.strftime("%Y-%m-%d")
    page_data = {}

    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(
                cdp_ws,
                headers={"Authorization": f"Bearer {airtop_key}"}
            )
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()

            def _do_login():
                """Fill email → continue → password → submit. Returns True if completed."""
                cur_url = page.url
                logger.info("Login page detected: %s", cur_url[:80])
                # Email
                try:
                    page.wait_for_selector('#ap_email, input[name="email"]', timeout=8000)
                    inp = page.query_selector('#ap_email') or page.query_selector('input[name="email"]')
                    if inp:
                        inp.fill(email)
                    btn = page.query_selector('#continue, input[name="continue"]')
                    if btn:
                        btn.click()
                        time.sleep(2)
                except Exception as ex:
                    logger.warning("Email fill failed: %s", ex)
                # Password
                try:
                    page.wait_for_selector('#ap_password, input[name="password"]', timeout=10000)
                    pw = page.query_selector('#ap_password') or page.query_selector('input[name="password"]')
                    if pw:
                        pw.fill(password)
                    submit = page.query_selector('#signInSubmit, input[type="submit"]')
                    if submit:
                        submit.click()
                    page.wait_for_load_state("networkidle", timeout=25000)
                    time.sleep(3)
                    logger.info("Post-login URL: %s", page.url)
                    return True
                except Exception as ex:
                    logger.warning("Password fill failed: %s", ex)
                    return False

            def _check_and_login():
                """Check if on login page by URL or by presence of login form."""
                cur = page.url
                has_login_url = any(x in cur for x in ["ap/signin", "ap/cvf", "signin.amazon", "login"])
                has_login_form = bool(page.query_selector('#ap_email, input[name="email"]'))
                if has_login_url or has_login_form:
                    _do_login()
                else:
                    logger.info("No login needed (url=%s)", cur[:60])

            # ── Step 1: Land on Associates Central, wait for React hydration ──
            logger.info("Navigating to Associates Central for %s...", email)
            page.goto("https://affiliate-program.amazon.com/home/summary",
                      wait_until="networkidle", timeout=40000)

            # Wait up to 15s for React to hydrate — look for any visible text
            try:
                page.wait_for_function(
                    "() => document.body.innerText.trim().length > 50",
                    timeout=15000
                )
            except Exception:
                pass  # Might be on login page — handle below

            body_text = page.evaluate("() => document.body.innerText") or ""
            logger.info("Initial URL: %s | body length: %d | first200: %s",
                        page.url, len(body_text), body_text[:200].replace('\n', ' '))
            _check_and_login()

            # Wait again after potential login for the page to re-render
            try:
                page.wait_for_function(
                    "() => document.body.innerText.trim().length > 100",
                    timeout=20000
                )
            except Exception:
                pass

            # ── Step 2: Download the earnings CSV directly ─────────────
            # Associates Central exposes a CSV download that doesn't need JS interaction
            csv_url = (
                f"https://affiliate-program.amazon.com/home/reports/download"
                f"?reportType=earning&dateRangeValue=custom"
                f"&startDate={start_date}&endDate={end_date}"
            )
            logger.info("Downloading earnings CSV: %s", csv_url)
            page.goto(csv_url, wait_until="domcontentloaded", timeout=30000)
            time.sleep(3)
            csv_content = page.evaluate("() => document.body.innerText")
            logger.info("CSV response length: %d chars", len(csv_content or ""))
            page_data["csv"] = csv_content or ""

            # ── Step 3: Also scrape the summary page DOM ───────────────
            page.goto("https://affiliate-program.amazon.com/home/summary",
                      wait_until="domcontentloaded", timeout=20000)
            page.wait_for_load_state("networkidle", timeout=10000)
            time.sleep(2)

            summary_data = page.evaluate("""
                () => {
                    const result = { metrics: {}, raw_text: '' };

                    // Associates Central uses data attributes on summary tiles
                    document.querySelectorAll('[data-summary-type], [class*="summary"], [class*="metric"], [class*="earning"]').forEach(el => {
                        const key = el.getAttribute('data-summary-type') || el.className.substring(0, 40);
                        result.metrics[key] = el.innerText.trim().substring(0, 100);
                    });

                    // Grab full page text for regex fallback
                    result.raw_text = document.body.innerText.substring(0, 5000);

                    // Look specifically for the earnings tile structure Amazon uses
                    const tiles = document.querySelectorAll('.report-summary-tile, .summary-tile, [data-testid]');
                    tiles.forEach((t, i) => {
                        result.metrics['tile_' + i] = t.innerText.trim().substring(0, 150);
                    });

                    return result;
                }
            """)
            page_data["summary"] = summary_data
            logger.info("Summary page URL: %s, metrics extracted: %d",
                        page.url, len(summary_data.get("metrics", {})))
            logger.info("Page text sample: %s", (summary_data.get("raw_text") or "")[:300])

            browser.close()

    finally:
        try:
            _airtop(airtop_key, "DELETE", f"/sessions/{session_id}")
        except Exception:
            pass

    return {
        "page_data": page_data,
        "start_date": start_date,
        "end_date": end_date,
    }


def _parse_earnings(raw: dict) -> Optional[dict]:
    """
    Parse DOM scrape / CSV download into standardized earnings dict.
    Returns: { revenue, commission, clicks, orders }
    """
    import re
    page_data = raw.get("page_data", {})

    # ── Try CSV download first ─────────────────────────────────────────────────
    # Associates earnings CSV columns: Date, Clicks, Ordered Items, Shipped Items,
    #   Returns, Revenue, Converted, Total Commissions
    csv_content = page_data.get("csv", "")
    if csv_content and "Clicks" in csv_content and len(csv_content) > 50:
        import csv, io
        try:
            reader = csv.DictReader(io.StringIO(csv_content))
            total_clicks = total_orders = total_revenue = 0
            rows_read = 0
            for row in reader:
                # Skip summary/total rows
                if not row.get("Date") or row["Date"].lower() in ("", "total", "date"):
                    continue
                # Handle different column name variations
                clicks_val = (row.get("Clicks") or row.get("clicks") or "0").replace(",", "")
                orders_val = (row.get("Shipped Items") or row.get("Ordered Items") or
                              row.get("shipped_items") or "0").replace(",", "")
                rev_val = (row.get("Total Commissions") or row.get("Revenue") or
                           row.get("total_commissions") or "0").replace(",", "").replace("$", "")
                try:
                    total_clicks += int(float(clicks_val))
                    total_orders += int(float(orders_val))
                    total_revenue += float(rev_val)
                    rows_read += 1
                except (ValueError, TypeError):
                    continue
            if rows_read > 0:
                logger.info("Parsed CSV: %d rows, clicks=%d, orders=%d, commission=%.2f",
                            rows_read, total_clicks, total_orders, total_revenue)
                return {
                    "clicks": total_clicks,
                    "orders": total_orders,
                    "revenue": total_revenue,
                    "commission": total_revenue,
                }
        except Exception as e:
            logger.warning("CSV parse failed: %s", e)

    # ── Try summary page DOM metrics ──────────────────────────────────────────
    summary = page_data.get("summary", {})
    raw_text = summary.get("raw_text", "")

    if raw_text:
        # Amazon summary shows: "Clicks\n1,234" or "Earnings\n$56.78" patterns
        clicks_match = re.search(r'Clicks\D*?([0-9,]+)', raw_text)
        orders_match = re.search(r'(?:Ordered Items|Orders|Converted Clicks|Items Shipped)\D*?([0-9,]+)', raw_text)
        earnings_match = re.search(r'(?:Earnings|Commission|Total Commissions|Revenue)\D*?\$([0-9,]+\.[0-9]{2})', raw_text)

        if earnings_match or clicks_match:
            clicks_val = int(clicks_match.group(1).replace(",", "")) if clicks_match else 0
            orders_val = int(orders_match.group(1).replace(",", "")) if orders_match else 0
            rev_val = float(earnings_match.group(1).replace(",", "")) if earnings_match else 0.0
            logger.info("Parsed DOM: clicks=%d, orders=%d, commission=%.2f",
                        clicks_val, orders_val, rev_val)
            return {
                "clicks": clicks_val,
                "orders": orders_val,
                "revenue": rev_val,
                "commission": rev_val,
            }

        # Last resort: find largest dollar amount on page
        amounts = re.findall(r'\$([0-9,]+\.[0-9]{2})', raw_text)
        if amounts:
            parsed = sorted([float(a.replace(",", "")) for a in amounts], reverse=True)
            logger.info("DOM fallback: found amounts %s, using largest", parsed[:3])
            return {
                "clicks": 0,
                "orders": 0,
                "revenue": parsed[0],
                "commission": parsed[0],
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
                csv_len = len(raw.get("page_data", {}).get("csv", ""))
                logger.warning("No earnings data extracted for %s. CSV length: %d", creator_id, csv_len)
                results.append({
                    "creator": creator_id,
                    "status": "no_data",
                    "csv_length": csv_len,
                })

        except Exception as e:
            logger.error("Amazon sync failed for %s: %s", creator_id, e, exc_info=True)
            results.append({"creator": creator_id, "status": "error", "error": str(e)})

        # Brief pause between creators to avoid session conflicts
        time.sleep(5)

    return {"synced": synced_at, "results": results}
