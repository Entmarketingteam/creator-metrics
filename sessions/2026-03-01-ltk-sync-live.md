# Session Summary — 2026-03-01: LTK Sync Now Live

## What Was Done

### 1. LTK Token Refresh (Manual)
Refreshed Nicki's expired LTK tokens via Airtop + Playwright CDP browser automation.

- Script: `/tmp/ltk_refresh_playwright.py`
- Flow: Airtop session → `creator.shopltk.com/login` → Playwright CDP → fill `inputs[0]` (email) / `inputs[1]` (password) → extract `@@auth0spajs@@` from localStorage → PATCH Airtable
- Credentials: `nicki.entenmann@gmail.com` (1Password Shared, item `qfr2fxyi2cvp3rq4xk7xxosglu`)
- Airtable record updated: `appQnKyfyRyhHX44h / tbl5TEfzBwGPeT1rX / recWJMXFphsCw8B1R`
- Fields: `Access_Token`, `ID_Token`, `Refresh_Token`, `Last_Refreshed`
- All 3 tokens extracted successfully at 01:21 UTC

### 2. LTK Sync Cron — Fixed and Confirmed Working
The `/api/cron/ltk-sync` route on Vercel was returning `upserted: 0` due to a stale debug deployment. After fixing and redeploying:

**Result:** `upserted: 2` (7-day + 30-day ranges both synced successfully)

**Root cause of previous failures:**
- `creator-api-gateway.shopltk.com` is NXDOMAIN — never resolves. Was the original API URL.
- Replaced with `https://api-gateway.rewardstyle.com` (confirmed via HAR analysis).
- Vercel `AIRTABLE_BASE_ID` correctly set to `appQnKyfyRyhHX44h` — the LTK credentials base.

### 3. LTK API Data
Nicki's earnings as of this sync:
- **Open earnings:** $7,261.73
- **Lifetime paid:** $280,886.48

## LTK API Reference

**Base URL:** `https://api-gateway.rewardstyle.com`

**Required headers:**
```
Authorization: Bearer {access_token}
x-id-token: {id_token}
Origin: https://creator.shopltk.com
Referer: https://creator.shopltk.com/
User-Agent: Mozilla/5.0 ...Chrome/122...
```

**Endpoints:**
| Endpoint | Returns |
|----------|---------|
| `GET /api/creator-analytics/v1/commissions_summary?currency=USD` | `open_earnings`, `lifetime_paid`, `payment_due` |
| `GET /api/creator-analytics/v1/performance_summary?start_date=...&end_date=...&publisher_ids=293045&platform=rs,ltk&timezone=UTC` | `clicks`, `orders`, `net_commissions` |
| `GET /api/creator-analytics/v1/items_sold/?limit=100&start=...&end=...&currency=USD` | Per-transaction sales |

## Vercel Env Vars (LTK)
| Key | Value |
|-----|-------|
| `AIRTABLE_TOKEN` | Airtable PAT (from Doppler `AIRTABLE_TOKEN`) |
| `AIRTABLE_BASE_ID` | `appQnKyfyRyhHX44h` |

## Previous Session (2026-02-28)
- Added `BrandBreakdown` component to earnings page (top 10 brands by ShopMy commission)
- Wired `OpportunityCommissions` into creator detail page (brand deals section)
- Deployed both to Vercel — ShopMy brand data + opportunity commissions now visible in dashboard

## Dashboard State
- **LTK:** Syncing ✅ (2 rows per daily cron run)
- **ShopMy:** Syncing ✅ (200 sales, brand breakdown visible)
- **Mavely:** Syncing ✅ (reads from Airtable written by n8n)
- **Amazon:** Schema ready, no sync route yet
- **Token rotation:** n8n workflow `zoqNMIxIaSxFWaGm` runs every 4h, keeps LTK tokens fresh

## Still Pending
- Amazon sync route (`/api/cron/amazon-sync`)
- Mavely n8n workflow (`3gYfgPzMu6wZ1OEZ`) — fix deployed, needs manual trigger to confirm
- Multi-creator IG Screenshots parameterization
