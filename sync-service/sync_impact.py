"""
Impact.com publisher API sync — fetches commission data for creators.

Authentication: HTTP Basic Auth with AccountSID (username) + AuthToken (password).
These are found in each creator's Impact.com dashboard under:
  Settings → API → Account SID / Auth Token

To set up a creator:
  1. Log into app.impact.com with creator creds
  2. Go to Settings → API
  3. Copy AccountSID and AuthToken
  4. Store in Doppler as IMPACT_{CREATOR_ID}_ACCOUNT_SID and IMPACT_{CREATOR_ID}_AUTH_TOKEN
  5. Add creator to IMPACT_CREATORS list below

API docs: https://developer.impact.com/default/documentation/Publisher-api
Earnings endpoint: GET /Mediapartners/{AccountSID}/Reports/mp_action_listing_sku.json
"""
import calendar
import logging
import os
from datetime import date, datetime, timedelta
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

IMPACT_API_BASE = "https://api.impact.com"

# Add creators here once AccountSID + AuthToken are retrieved from their dashboards
IMPACT_CREATORS = [
    {
        "id": "maganhendry",
        "account_sid_env": "IMPACT_MAGANHENDRY_ACCOUNT_SID",
        "auth_token_env": "IMPACT_MAGANHENDRY_AUTH_TOKEN",
    },
    # Add more creators as API credentials are collected:
    # {
    #     "id": "christiethomaswellness",
    #     "account_sid_env": "IMPACT_CHRISTIETHOMAS_ACCOUNT_SID",
    #     "auth_token_env": "IMPACT_CHRISTIETHOMAS_AUTH_TOKEN",
    # },
]


def _fetch_commissions(account_sid: str, auth_token: str, start_date: date, end_date: date) -> list[dict]:
    """Fetch all commission records from Impact.com for a date range."""
    url = f"{IMPACT_API_BASE}/Mediapartners/{account_sid}/Reports/mp_action_listing_sku.json"
    params = {
        "START_DATE": start_date.isoformat(),
        "END_DATE": end_date.isoformat(),
        "SUPERSTATUS_MS": "APPROVED,PENDING",
        "SHOW_STATUS_DETAIL": 1,
        "SHOW_PAYSTUB": 1,
        "SHOW_SKU": 1,
        "SHOW_LOCKING_DATE": 1,
        "SHOW_AD": 1,
        "SHOW_GEO_LOCATION": 1,
    }

    records = []
    next_url = None

    with httpx.Client(timeout=30) as client:
        while True:
            fetch_url = next_url or url
            fetch_params = {} if next_url else params

            resp = client.get(
                fetch_url,
                params=fetch_params,
                auth=(account_sid, auth_token),
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()

            page_records = data.get("Records", [])
            records.extend(page_records)
            logger.info("Fetched %d records (total %d)", len(page_records), len(records))

            next_url = data.get("@nextpageuri")
            if not next_url:
                break

    return records


def sync_impact(conn) -> dict:
    """
    Sync Impact.com commission data for all configured creators.
    Writes aggregate monthly totals to platform_earnings table.
    Syncs the current calendar month (Impact data updates throughout the month).
    """
    today = datetime.utcnow().date()
    period_start = date(today.year, today.month, 1)
    period_end   = date(today.year, today.month, calendar.monthrange(today.year, today.month)[1])

    results = []
    skipped = []

    for creator in IMPACT_CREATORS:
        creator_id   = creator["id"]
        account_sid  = os.environ.get(creator["account_sid_env"])
        auth_token   = os.environ.get(creator["auth_token_env"])

        if not account_sid or not auth_token:
            logger.warning(
                "Skipping %s — missing Impact.com API credentials (%s / %s). "
                "Log into app.impact.com → Settings → API to retrieve.",
                creator_id,
                creator["account_sid_env"],
                creator["auth_token_env"],
            )
            skipped.append(creator_id)
            continue

        logger.info("Syncing Impact.com for %s (%s to %s)...", creator_id, period_start, period_end)

        try:
            records = _fetch_commissions(account_sid, auth_token, period_start, period_end)
        except httpx.HTTPStatusError as e:
            logger.error("Impact.com API error for %s: %s %s", creator_id, e.response.status_code, e.response.text[:200])
            results.append({"creator": creator_id, "status": "error", "error": str(e)})
            continue

        # Aggregate totals for the calendar month
        total_revenue    = sum(float(r.get("Sale_Amount", 0) or 0) for r in records)
        total_commission = sum(float(r.get("Payout", 0) or 0) for r in records)
        approved_count   = sum(1 for r in records if r.get("Status") == "APPROVED")
        pending_count    = sum(1 for r in records if r.get("Status") == "PENDING")

        # Determine overall status: paid if all approved, pending if any pending
        agg_status = "pending" if pending_count > 0 else "paid"

        # Upsert monthly aggregate into platform_earnings (unique on creator_id, platform, period_start, period_end)
        conn.execute("""
            INSERT INTO platform_earnings
              (creator_id, platform, revenue, commission, orders, status, period_start, period_end, synced_at)
            VALUES ($1, 'impact', $2, $3, $4, $5::earnings_status, $6, $7, NOW())
            ON CONFLICT (creator_id, platform, period_start, period_end)
            DO UPDATE SET
              revenue=$2, commission=$3, orders=$4, status=$5::earnings_status, synced_at=NOW()
        """,
            creator_id,
            str(round(total_revenue, 2)),
            str(round(total_commission, 2)),
            len(records),
            agg_status,
            period_start,
            period_end,
        )

        logger.info(
            "Impact sync done for %s: %d records, $%.2f revenue, $%.2f commission",
            creator_id, len(records), total_revenue, total_commission
        )
        results.append({
            "creator": creator_id,
            "records": len(records),
            "revenue": round(total_revenue, 2),
            "commission": round(total_commission, 2),
        })

    return {
        "status": "ok",
        "synced": results,
        "skipped": skipped,
        "period": {"start": str(period_start), "end": str(period_end)},
    }
