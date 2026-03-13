"""
Amazon Associates Reporting API sync.

Flow:
  1. Load reporting page with stored session cookies → extract Bearer JWT + CSRF token from HTML
  2. POST /reporting/export with date range query → triggers async export job
  3. Poll GET /reporting/export/status?store_id=... until COMPLETED
  4. Download ZIP from file_path in status response
  5. Unzip + parse CSV → return earnings dict

Requires cookies from amazon_auth.refresh_cookies_if_needed().
"""

import io
import logging
import re
import time
import zipfile
from datetime import date, datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_BASE = "https://affiliate-program.amazon.com"

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
}

_API_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    "Origin": _BASE,
    "Referer": f"{_BASE}/p/reporting/earnings",
    # Amazon marketplace constants (US)
    "marketplaceid": "ATVPDKIKX0DER",
    "programid": "1",
    "roles": "Primary",
}


def _extract_bearer_token(html: str) -> Optional[str]:
    """Extract the JWE Bearer token from reporting page HTML."""
    # Token starts with eyJ6aXAiOiJERUYi (base64 of {"zip":"DEF")
    m = re.search(r'(eyJ6aXAiOiJERUYi[A-Za-z0-9._\-]+)', html)
    if m:
        return m.group(1)
    # Fallback: any eyJ token that looks like a JWE (5 base64url parts)
    m = re.search(r'"(eyJ[A-Za-z0-9._\-]{100,})"', html)
    if m:
        return m.group(1)
    return None


def _extract_csrf_token(html: str) -> Optional[str]:
    """Extract anti-CSRF token from reporting page HTML."""
    # Amazon stores it in <meta name="anti-csrftoken-a2z" content="...">
    m = re.search(r'<meta[^>]+name="anti-csrftoken-a2z"[^>]+content="([^"]+)"', html, re.IGNORECASE)
    if m:
        return m.group(1)
    # Try reversed attribute order
    m = re.search(r'<meta[^>]+content="([^"]{20,})"[^>]+name="anti-csrftoken-a2z"', html, re.IGNORECASE)
    if m:
        return m.group(1)
    return None
def _extract_customer_id(html: str) -> Optional[str]:
    """Extract Amazon customer ID from page HTML."""
    m = re.search(r'"customerId"\s*:\s*"([A-Z0-9]{10,20})"', html)
    if m:
        return m.group(1)
    m = re.search(r'customerid["\s:]+([A-Z0-9]{10,20})', html, re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def _load_reporting_page(session_cookies: dict) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Load the reporting page and extract Bearer token, CSRF token, and customer ID.
    Returns (bearer_token, csrf_token, customer_id) — any may be None on failure.
    """
    with httpx.Client(headers=_BROWSER_HEADERS, follow_redirects=True, timeout=30) as client:
        resp = client.get(f"{_BASE}/p/reporting/earnings", cookies=session_cookies)
        if resp.status_code != 200:
            logger.warning("Reporting page returned %d", resp.status_code)
            return None, None, None
        if "signin" in str(resp.url).lower() or "ap/signin" in resp.text:
            logger.warning("Reporting page redirected to signin — cookies expired")
            return None, None, None

        html = resp.text
        bearer = _extract_bearer_token(html)
        csrf = _extract_csrf_token(html)
        customer_id = _extract_customer_id(html)

        logger.info("Reporting page loaded. bearer=%s csrf=%s customer_id=%s",
                    "✓" if bearer else "✗",
                    "✓" if csrf else "✗",
                    customer_id or "✗")
        return bearer, csrf, customer_id


def _build_query(start_date: date, end_date: date, store_id: str) -> dict:
    """Build the POST body for /reporting/export."""
    # Amazon expects ISO timestamps at midnight UTC
    from_dt = datetime(start_date.year, start_date.month, start_date.day, 0, 0, 0, tzinfo=timezone.utc)
    to_dt = datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59, tzinfo=timezone.utc)

    return {
        "query": {
            "fromDate": from_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "toDate": to_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "selectionType": "custom",
            "ext": "csv",
            "trackingId": "all",
            # Only enable the trackingid summary report — aggregated totals per tag
            "orders": {"enabled": False},
            "earnings": {"enabled": False},
            "tracking": {"enabled": False},
            "linktype": {"enabled": False},
            "trends": {"enabled": False},
            "bounty": {"enabled": False},
            "earnings_hva": {"enabled": False},
            "orders_with_clicks": {"enabled": False},
            "creativeasin": {"enabled": False},
            "category": {"enabled": False},
            "trackingid": {"enabled": True},
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "cache_filter": "custom",
            "types": ["trackingid"],
            "trackingid_filter": {"tag_id": "all"},
        },
        "store_id": store_id,
    }


def _trigger_export(
    bearer: str,
    csrf: str,
    customer_id: str,
    store_id: str,
    start_date: date,
    end_date: date,
    session_cookies: dict,
) -> bool:
    """POST to /reporting/export to kick off async CSV generation. Returns True on success."""
    headers = {
        **_API_HEADERS,
        "Authorization": f"Bearer {bearer}",
        "anti-csrftoken-a2z": csrf,
        "customerid": customer_id,
        "storeid": store_id,
    }
    body = _build_query(start_date, end_date, store_id)
    logger.info("Triggering export: %s → %s", start_date, end_date)

    with httpx.Client(follow_redirects=True, timeout=30) as client:
        resp = client.post(
            f"{_BASE}/reporting/export",
            headers=headers,
            cookies=session_cookies,
            json=body,
        )

    logger.info("Export trigger response: %d — %s", resp.status_code, resp.text[:200])
    return resp.status_code in (200, 201, 202)


def _poll_status(
    bearer: str,
    csrf: str,
    customer_id: str,
    store_id: str,
    session_cookies: dict,
    max_wait: int = 120,
    interval: int = 5,
) -> Optional[str]:
    """
    Poll /reporting/export/status until a report is COMPLETED.
    Returns the file_path (download URL) or None on timeout/failure.
    """
    headers = {
        **_API_HEADERS,
        "Authorization": f"Bearer {bearer}",
        "anti-csrftoken-a2z": csrf,
        "customerid": customer_id,
        "storeid": store_id,
    }
    url = f"{_BASE}/reporting/export/status?store_id={store_id}"
    deadline = time.time() + max_wait

    while time.time() < deadline:
        with httpx.Client(follow_redirects=True, timeout=30) as client:
            resp = client.get(url, headers=headers, cookies=session_cookies)

        if resp.status_code != 200:
            logger.warning("Status poll returned %d", resp.status_code)
            time.sleep(interval)
            continue

        try:
            jobs = resp.json()
        except Exception:
            logger.warning("Status response not JSON: %s", resp.text[:200])
            time.sleep(interval)
            continue

        if not isinstance(jobs, list):
            jobs = [jobs]

        for job in jobs:
            status = (job.get("status") or "").upper()
            file_path = job.get("file_path") or job.get("filePath")
            report_name = job.get("report_name", "")
            logger.info("Job %s: status=%s file_path=%s", report_name, status, file_path)

            if status == "COMPLETED" and file_path:
                return file_path

        # All THROTTLED or IN_PROGRESS — keep waiting
        time.sleep(interval)

    logger.error("Export timed out after %ds", max_wait)
    return None


def _download_and_parse_zip(file_path: str, session_cookies: dict) -> Optional[dict]:
    """
    Download the ZIP from file_path, unzip, parse the trackingid CSV.
    Returns { clicks, orders, revenue, commission } or None.
    """
    # file_path may be a relative path like /reporting/export/download/... or a full URL
    if file_path.startswith("/"):
        url = f"{_BASE}{file_path}"
    else:
        url = file_path

    logger.info("Downloading report ZIP: %s", url)
    with httpx.Client(follow_redirects=True, timeout=60) as client:
        resp = client.get(url, headers=_BROWSER_HEADERS, cookies=session_cookies)

    if resp.status_code != 200:
        logger.error("ZIP download returned %d", resp.status_code)
        return None

    try:
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
    except Exception as e:
        logger.error("Not a valid ZIP: %s", e)
        return None

    csv_files = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    if not csv_files:
        logger.error("No CSV in ZIP. Contents: %s", zf.namelist())
        return None

    # Parse the trackingid CSV
    # Format: Tracking Id,Clicks,Items Ordered,Ordered Revenue,Items Shipped,...,Total Earnings,...
    csv_text = zf.read(csv_files[0]).decode("utf-8", errors="replace")
    return _parse_tracking_csv(csv_text)


def _parse_tracking_csv(csv_text: str) -> Optional[dict]:
    """
    Parse the Tracking Id summary CSV.
    Returns { clicks, orders, revenue, commission }.
    """
    import csv

    total_clicks = 0
    total_orders = 0
    total_revenue = 0.0
    total_commission = 0.0
    rows = 0

    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        def _f(keys):
            for k in keys:
                v = (row.get(k) or "").replace(",", "").replace("$", "").strip()
                if v:
                    try:
                        return float(v)
                    except ValueError:
                        continue
            return 0.0

        total_clicks += int(_f(["Clicks"]))
        total_orders += int(_f(["Items Shipped", "Items Ordered"]))
        total_revenue += _f(["Items Shipped Revenue", "Ordered Revenue"])
        total_commission += _f(["Total Earnings"])
        rows += 1

    if rows == 0:
        logger.warning("Tracking CSV parsed 0 rows")
        return None

    return {
        "clicks": total_clicks,
        "orders": total_orders,
        "revenue": round(total_revenue, 2),
        "commission": round(total_commission, 2),
    }


def fetch_earnings(
    session_cookies: dict,
    store_id: str,
    start_date: date,
    end_date: date,
    customer_id_override: Optional[str] = None,
) -> Optional[dict]:
    """
    High-level entry point. Returns earnings dict or None on failure.

    Args:
        session_cookies: Dict of cookies (session-id, session-token, x-main, etc.)
        store_id: Amazon Associates tracking tag (e.g. "nickientenman-20")
        start_date / end_date: Date range for the report
        customer_id_override: If known, skip page scrape for customer ID
    """
    # Step 1: Load page to get Bearer + CSRF + customer ID
    bearer, csrf, page_customer_id = _load_reporting_page(session_cookies)
    customer_id = customer_id_override or page_customer_id

    if not bearer or not csrf:
        logger.error("Could not extract Bearer/CSRF from reporting page")
        return None

    if not customer_id:
        logger.error("Could not determine customer ID — add AMAZON_{ID}_CUSTOMER_ID to Doppler")
        return None

    # Step 2: Trigger export
    ok = _trigger_export(bearer, csrf, customer_id, store_id, start_date, end_date, session_cookies)
    if not ok:
        logger.error("Export trigger failed")
        return None

    # Step 3: Poll for completion (up to 2 minutes)
    file_path = _poll_status(bearer, csrf, customer_id, store_id, session_cookies)
    if not file_path:
        logger.error("Export did not complete in time")
        return None

    # Step 4: Download + parse
    return _download_and_parse_zip(file_path, session_cookies)
