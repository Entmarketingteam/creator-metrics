# Amazon Affiliate Sync — Implementation Plan
**Date:** 2026-03-12
**Status:** Ready to implement
**Priority:** High — last missing platform for Nicki's full earnings dashboard

---

## Context / What Failed Before

| Attempt | Approach | Why It Failed |
|---------|----------|---------------|
| 1 | Airtop + DOM scraping | Associates Central SPA loads blank HTML, can't scrape |
| 2 | Playwright + TOTP 2FA | Amazon bot detection, CAPTCHAs |
| 3 | Playwright + stealth | Still flagged |
| 4 | Stored session cookies | Cookies expire, manual re-extraction needed, fragile |

**Key insight:** We have a registered Amazon developer app with OAuth credentials already in Doppler (`ent-agency-analytics`). None of the previous attempts used the official API — they all tried to scrape the Associates Central UI. The proper path is the **Amazon Creators API** via OAuth2.

---

## What We Have in Doppler (ent-agency-analytics)

```
AMAZON_CLIENT_ID     = amzn1.application-oa2-client.f756...
AMAZON_CLIENT_SECRET = amzn1.oa2-cs.v1.b734...
AMAZON_OAUTH_SCOPE   = creatorsapi::default
AMAZON_TOKEN_ENDPOINT = https://api.amazon.com/auth/O2/token
AMAZON_ASSOCIATE_TAG = nickientenman-20
AMAZON_API_VERSION   = 3.1
```

This is an **Amazon Influencer / Creators API** app — not the old Product Advertising API.

---

## Step 1 — Test Auth Flow (do this first)

### Option A: Client Credentials (no user involvement)

Try this first. Some Creators API scopes support machine-to-machine auth:

```bash
curl -X POST https://api.amazon.com/auth/O2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$AMAZON_CLIENT_ID" \
  -d "client_secret=$AMAZON_CLIENT_SECRET" \
  -d "scope=creatorsapi::default"
```

**If this returns a token → we're done with auth, go to Step 2.**

**If it returns `unsupported_grant_type` or `invalid_scope`:**

### Option B: Authorization Code Flow (creator must authorize once)

The creator visits a URL, logs in, and grants access. We get a one-time `code`, exchange it for `access_token` + `refresh_token`. Store the refresh token in Doppler. From that point on, the cron uses the refresh token silently.

**One-time auth URL to send to Nicki:**
```
https://www.amazon.com/ap/oa
  ?client_id=amzn1.application-oa2-client.f75634668bf3400dacf6b3c13f9e28a2
  &scope=creatorsapi::default
  &response_type=code
  &redirect_uri=https://creator-metrics.vercel.app/api/amazon/callback
  &state=nicki_entenmann
```

**Callback handler** (`/api/amazon/callback`) exchanges code for tokens:
```
POST https://api.amazon.com/auth/O2/token
  grant_type=authorization_code
  code={code from callback}
  client_id=...
  client_secret=...
  redirect_uri=https://creator-metrics.vercel.app/api/amazon/callback
```

Store `refresh_token` in Doppler as `AMAZON_NICKI_REFRESH_TOKEN`.

**Token refresh in cron:**
```
POST https://api.amazon.com/auth/O2/token
  grant_type=refresh_token
  refresh_token=$AMAZON_NICKI_REFRESH_TOKEN
  client_id=...
  client_secret=...
```

---

## Step 2 — Find the Earnings Endpoints

The `creatorsapi::default` scope is the **Amazon Influencer Program / Creators API**. Possible base URLs (try in order):

### Candidate A: Amazon Creators API (Influencer program)
```
GET https://api.amazon.com/creators/v1/earnings
GET https://api.amazon.com/creators/v1/analytics/earnings
Authorization: Bearer {access_token}
```

### Candidate B: Associates API
```
GET https://affiliate-program.amazon.com/v1/reports
GET https://affiliate-program.amazon.com/v3/commissions
Authorization: Bearer {access_token}
```

### Candidate C: SP-API (Selling Partner — unlikely for affiliates)
```
GET https://sellingpartnerapi-na.amazon.com/finances/v0/financialEvents
```

### How to discover endpoints:
After getting a valid token, try:
```bash
# Test with Creators API base
curl https://api.amazon.com/creators/v1/profile \
  -H "Authorization: Bearer {token}" \
  -H "x-amz-date: $(date -u +%Y%m%dT%H%M%SZ)"

# Check what error you get — 404 means wrong path, 403 means wrong scope/permissions
```

**The API docs are at:** https://developer.amazon.com/docs/creators/overview.html
(May require logging into Amazon developer account to view)

---

## Step 3 — Data Model

What we want from Amazon (matches `platform_earnings` schema):

| Field | Amazon equivalent |
|-------|-------------------|
| `revenue` | Gross sales (shipped items × price) |
| `commission` | Net affiliate earnings |
| `clicks` | Clicks on affiliate links |
| `orders` | Total orders placed |
| `platform` | `"amazon"` |
| `creator_id` | `"nicki_entenmann"` |
| `period_start` | Start of reporting window |
| `period_end` | End of reporting window |

For `sales` table (transaction-level):
- `product_name` — product title
- `brand` — seller name
- `revenue` — item price
- `commission` — commission earned
- `status` — `open` / `pending` / `paid`

---

## Step 4 — Implementation Files

### Files to create:
```
lib/amazon.ts                          # Auth + API client
app/api/cron/amazon-sync/route.ts      # Daily cron
app/api/amazon/callback/route.ts       # OAuth callback (one-time setup)
app/api/amazon/auth/route.ts           # Generates the auth URL
```

### Files to update:
```
vercel.json                            # Add amazon-sync cron
lib/schema.ts                          # Add amazon_refresh_token to creator_tokens if needed
```

### Pattern to follow:
Mirror `app/api/cron/shopmy-sync/route.ts` — it's the cleanest:
1. Get token (from Doppler refresh_token or client_credentials)
2. Fetch earnings summary → upsert to `platform_earnings`
3. Fetch transactions → upsert to `sales`
4. Return `{ success, upserted, errors }`

---

## Step 5 — Fallback Plan (if API is inaccessible)

If the Creators API doesn't expose earnings (some Creators API scopes only give content/storefront data, not earnings), the cleanest non-scraping fallback is:

**Amazon Associates CSV download via cookie refresh:**
- Build a one-time local script that a person runs in their browser (extension or bookmarklet) to export and upload the CSV
- Or use the **SiteStripe API** (limited, but doesn't require full login)
- Or check if Amazon has added an official Associates API (they've been promising one since 2023)

---

## Cron Schedule to Add

```json
{
  "path": "/api/cron/amazon-sync",
  "schedule": "0 9 * * *"
}
```

9am UTC = 4am EST — after all other syncs settle.

---

## Env Vars Needed in Vercel

Add from Doppler `ent-agency-analytics`:
```
AMAZON_CLIENT_ID
AMAZON_CLIENT_SECRET
AMAZON_OAUTH_SCOPE
AMAZON_TOKEN_ENDPOINT
```

Add after OAuth flow completes (one per creator):
```
AMAZON_NICKI_REFRESH_TOKEN    (or to Doppler)
```

---

## Start Here Tomorrow

```bash
# 1. Load the env vars
doppler run --project ent-agency-analytics --config prd -- bash

# 2. Try client credentials first
curl -X POST $AMAZON_TOKEN_ENDPOINT \
  -d "grant_type=client_credentials&client_id=$AMAZON_CLIENT_ID&client_secret=$AMAZON_CLIENT_SECRET&scope=$AMAZON_OAUTH_SCOPE"

# 3. If token returned, test against Creators API
# 4. If 401/403, build the callback route and do auth code flow
```

---

## Notes
- Associate tag for Nicki: `nickientenman-20` (already in Doppler)
- Previous sync code lives in git history at commit `3ac49e5` (cookie approach) and `9400a69` (Playwright approach) — can reference for data parsing logic
- The sync-service Python scripts (`sync-service/sync_amazon.py`) also have CSV parsing logic worth porting to TypeScript
