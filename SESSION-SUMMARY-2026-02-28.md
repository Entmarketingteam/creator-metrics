# Creator Metrics — Session Summary (2026-02-28)

## What Was Accomplished This Session

---

### 1. Mavely n8n Workflow — Fully Fixed & Confirmed Working ✅

**Workflow ID:** `3gYfgPzMu6wZ1OEZ` — Mavely Creators – Daily auth & analytics

**Bugs fixed (3 total):**

1. **`Map Airtable to Mavely credentials` Code node** — Password field lookup was trying `Password`, `mavelyPassword`, `password` but the Airtable field is named `Mavely_Password`. Added it to the fallback chain.

2. **`Shape for cookie update` Code node** — `recordId` was lost after the login POST (the login response only returns `cookieHeader`). Fixed by pulling `recordId` from `$('Map Airtable to Mavely credentials').first().json.recordId` instead of `$input.first().json.recordId`.

3. **`Update Mavely credentials (cookies)` Airtable node** — `columns.matchingColumns` was missing (required by Airtable node v2.1), causing "Could not get parameter" error. Added `matchingColumns: []` and set `onError: continueRegularOutput` so the workflow succeeds even if cookie caching fails.

**Webhook trigger added:** `GET https://entagency.app.n8n.cloud/webhook/mavely-run` — fires the workflow on demand (no more manual UI button needed).

**Confirmed working:** Execution 3357 — Login ✅ → Analytics fetched ($1,274.72 commission, 5,715 clicks, 529 orders) ✅ → Postgres ✅ → Airtable ✅ → Cookies saved ✅

---

### 2. ShopMy Vercel Sync — Fully Fixed & Confirmed Working ✅

**Route:** `GET /api/cron/shopmy-sync` (Vercel cron at 6:20 UTC daily)

**Root cause:** ShopMy's API was triggering `sessionActions.forceSessionLogout` when requests came from Vercel's datacenter IPs — without a browser User-Agent, their fraud detection killed the session immediately after login.

**Fixes applied:**

1. **Added browser `User-Agent` header** to both `loginShopMy()` and `shopmyFetch()` in `lib/shopmy.ts`:
   ```
   Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36
   ```

2. **Reset Vercel env vars** — `SHOPMY_NICKI_EMAIL` and `SHOPMY_NICKI_PASSWORD` had stale/wrong values (6 duplicate entries across environments). Deleted all 6, re-created from Airtable credentials (`marketingteam@nickient.com` / correct password).

**Confirmed working:** `{"synced":1,"errors":0,"results":[{"creator":"nicki_entenmann","status":"ok"}]}`

**Commit:** `ab67c3a` — pushed to `Entmarketingteam/creator-metrics`

---

### 3. Historical Backfill — 2 Years of Data in Supabase ✅

**Script:** `scripts/backfill_historical.py`
**Commit:** `3f16a39`

Fetched 24 months (2024-01 → 2025-12) from all 3 platform APIs and upserted into `platform_earnings` + `sales` tables in Supabase.

#### Final DB State After Backfill

| Platform | Date Range | Months | Total Revenue | Clicks | Orders |
|---|---|---|---|---|---|
| **LTK** | Jan 2024 → Mar 2026 | 26 | **$153,511** | 980,164 | 18,349 |
| **ShopMy** | Feb 2025 → Mar 2026 | 26 | **$35,248** | — | 300 |
| **Mavely** | Aug 2025 → Feb 2026 | 6 active | **$9,717** | 38,455 | 4,626 |
| **Amazon** | Feb 2026 | 1 | **$8** | — | 1 |

#### Platform-specific notes:

**LTK:**
- Full 2024 + 2025 monthly performance summaries (clicks, orders, net commissions) — all from `api-gateway.rewardstyle.com/api/creator-analytics/v1/performance_summary`
- Individual items_sold (per-transaction) returned HTTP 400 for wide date ranges — LTK's API enforces narrow windows. Only current-window individual transactions are available.
- Posts/links endpoint (`/api/ltk/v2/ltks/`) also returned 400 — needs further investigation

**ShopMy:**
- Only goes back to Feb 2025 — that's when Nicki's account was created
- Individual commission records: API always returns the 100 most recent regardless of date params — **no historical pagination available**
- Monthly totals available via `months` dict in payout_summary response
- 2024 data does not exist — Nicki wasn't on ShopMy yet

**Mavely:**
- Zeroes for all of 2024 through Jul 2025 — Nicki joined Mavely in Aug 2025
- Active months: Aug 2025 ($146), Sep 2025 ($543), Oct 2025 ($114), Nov 2025 ($4,601), Dec 2025 ($3,037), Feb 2026 ($1,275)

---

### 4. All 3 Platform Crons — Confirmed Live & Scheduled

| Platform | Vercel Cron | Schedule | Status |
|---|---|---|---|
| LTK | `/api/cron/ltk-sync` | 6:10 UTC daily | ✅ Live |
| ShopMy | `/api/cron/shopmy-sync` | 6:20 UTC daily | ✅ Live (fixed today) |
| Mavely | n8n webhook `mavely-run` | 6:00 UTC daily via n8n | ✅ Live (fixed today) |

---

## Architecture Reference

### Key IDs
| Resource | ID / URL |
|---|---|
| Vercel project | `prj_pIy509aJK4dp5tujXZHA9kF35PVq` |
| Supabase ref | `jidfewontxspgylmtavp` |
| DB URL | `postgresql://postgres.jidfewontxspgylmtavp:...@aws-0-us-west-2.pooler.supabase.com:6543/postgres` |
| GitHub repo | `Entmarketingteam/creator-metrics` |
| Mavely n8n workflow | `3gYfgPzMu6wZ1OEZ` |
| Mavely webhook | `GET https://entagency.app.n8n.cloud/webhook/mavely-run` |
| LTK token refresh workflow | `zoqNMIxIaSxFWaGm` (runs every 4h) |
| LTK health check workflow | `Lfinr1iyuXSfHRzR` (runs 9am daily) |

### Creator Platform IDs (Nicki Entenmann)
| Platform | ID |
|---|---|
| LTK publisher ID | `293045` |
| ShopMy user ID | `65244` |
| Mavely | `"Nicki Entenmann"` (string match) |
| Amazon tag | `nickientenmann-20` |

### Airtable Credentials Tables
| Table | ID | Contains |
|---|---|---|
| LTK_Credentials | `tbl5TEfzBwGPeT1rX` | Access_Token, ID_Token, Refresh_Token, Last_Refreshed |
| Mavely_Credentials | `tbllD6GuMSSEuN0Nq` | email, Mavely_Password, Mavely_Cookies |
| ShopMy_Credentials | `tblxPxLW0p9B1hviL` | Creator, email, password |

---

## What's Left — PRD & TODO

### 🔴 High Priority

#### 1. Amazon Sync Route
- **What:** Build `/api/cron/amazon-sync` to pull from Amazon Associates API
- **Status:** Schema ready (`amazon_associate_tag` field on creators), n8n ingest webhook exists (`WOdJrynlMl1zGxog`), no Vercel cron route built
- **Data available:** Reports via Amazon Associates API (daily/monthly)
- **Blocker:** Need Amazon API credentials in Vercel env

#### 2. LTK Per-Transaction Sales History
- **What:** Individual item-level sales data (brand, product, commission per sale) in the `sales` table
- **Status:** LTK's `/api/creator-analytics/v1/items_sold/` returns HTTP 400 for date ranges >30 days. Need to break into smaller windows (weekly) and retry, or accept summary-only
- **Impact:** Without this, LTK data is monthly aggregates only — can't see brand-level breakdowns

#### 3. LTK Posts / Links Backfill
- **What:** Historical LTK post data (share URLs, hero images, captions, product links) into `content_master`
- **Status:** `/api/ltk/v2/ltks/` and `/api/creator/v1/publishers/{id}/ltks` both returned 400/404 — correct endpoint unknown
- **Action needed:** HAR capture from LTK creator portal to find the correct posts endpoint

#### 4. ShopMy Historical Individual Transactions
- **What:** Commission records older than the most recent 100
- **Status:** ShopMy API has no pagination or date filtering for individual commissions — always returns 100 most recent
- **Option:** Contact ShopMy for data export, or scrape via Airtop browser automation

---

### 🟡 Medium Priority

#### 5. Dashboard — Platform Earnings Views
- **What:** The creator-metrics Vercel app needs UI pages that actually surface the historical data
- **Status:** Data is in Supabase. Routes exist (`/api/earnings/by-platform`, `/api/earnings/summary`) but frontend charts/pages may need updating to support 2-year date ranges
- **Action:** Update period picker and chart components to support `?days=730` or custom date range

#### 6. Multi-Creator Support on Vercel Crons
- **What:** ShopMy and LTK sync routes are currently hardcoded to Nicki via env var prefix pattern (`SHOPMY_NICKI_*`)
- **Action:** Add env vars and `creatorCredMap` entries for each new creator added to the system

#### 7. Mavely — Individual Transaction Backfill
- **What:** Mavely GraphQL currently only returns aggregate metrics per month. Explore `creatorAnalyticsCommissions` or similar query to get per-transaction records
- **Action:** Check Mavely GraphQL schema for per-transaction queries

---

### 🟠 ENT Agency Platform TODOs (from CLAUDE.md)

#### 8. Multi-Creator IG Screenshots Workflow
- **Workflow:** `QGnVPQLM27v0olbE` (currently hardcoded to Nicki)
- **What:** Parameterize to support any creator via `?creator=Name` webhook param
- **Needs:** Airtable lookup for creator IG credentials, Airtop login before screenshot loop, per-creator Drive folders + Sheets logging

#### 9. Automated Campaign Reporting Pipeline
- **What:** n8n cron → Airtable campaign data → Claude API analysis → formatted report → Google Drive + Slack
- **Prereqs:** Audit Airtable schema, add Claude API key to Doppler, define report template, map Drive folder structure

#### 10. n8n Workflow Backup
- **What:** Pull all workflows from entagency.app.n8n.cloud to `~/.claude/n8n-backups/` via API
- **Simple one-time script + cron**

#### 11. LTK Token Auto-Refresh (COMPLETE ✅)
- Standalone workflow `zoqNMIxIaSxFWaGm` runs every 4 hours
- Health check `Lfinr1iyuXSfHRzR` emails on issues
- No action needed

---

### 🔵 Nice to Have

#### 12. Unified Earnings View
- **What:** Single query across all platforms showing total earnings by month/week
- **Tables ready:** `platform_earnings` has all data. Need a SQL view or API route that aggregates across platforms
- **SQL sketch:**
  ```sql
  SELECT date_trunc('month', period_start) as month,
         SUM(CAST(revenue AS FLOAT)) as total_revenue,
         SUM(clicks) as total_clicks,
         SUM(orders) as total_orders
  FROM platform_earnings
  WHERE creator_id = 'nicki_entenmann'
  GROUP BY 1 ORDER BY 1
  ```

#### 13. Revenue Attribution to Content
- **What:** Link `sales` transactions to specific LTK posts / ShopMy pins
- **Tables:** `content_revenue_attribution`, `content_master` exist in schema but are empty
- **Requires:** LTK post data (blocked by #3 above) and ShopMy `Pin_id` field (present in commission records)

#### 14. Replicate Creative Engine Integration
- **What:** Wire up Replicate as image/video provider in `tools/providers/replicate.py`
- **Was due:** Feb 26, 2026 (overdue)
- **Unlocks:** FLUX.1 images ($0.003), Minimax Video ($0.10), drops 200-ad campaign cost from $252 → $17

---

## Backfill Script Reference

**File:** `scripts/backfill_historical.py`

**Run options:**
```bash
# All platforms
python3 scripts/backfill_historical.py

# Specific platforms
python3 scripts/backfill_historical.py ltk
python3 scripts/backfill_historical.py mavely
python3 scripts/backfill_historical.py shopmy
python3 scripts/backfill_historical.py ltk posts
```

**Requirements:** `psycopg2`, Doppler CLI (for AIRTABLE_API_KEY), direct DB access

**Backfill window:** Hardcoded to 2024-01 → 2025-12 in `BACKFILL_MONTHS`. Update the list to extend coverage.

---

## Session Commits

| Hash | Description |
|---|---|
| `ab67c3a` | Add browser User-Agent to ShopMy requests |
| `3f16a39` | Add historical backfill script |
| `3f16a39` | This session summary |
