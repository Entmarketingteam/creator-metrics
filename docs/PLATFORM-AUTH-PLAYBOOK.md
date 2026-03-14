# Platform Auth Playbook — Creator Metrics

> **Purpose**: Replicable authentication and data-sync patterns for every affiliate/analytics platform integrated into creator-metrics. Written so any developer can onboard a new creator or add a new platform by following the relevant section.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Amazon Associates](#2-amazon-associates)
3. [LTK (rewardStyle / ShopLTK)](#3-ltk-rewardstyle--shopltk)
4. [ShopMy](#4-shopmy)
5. [Mavely](#5-mavely)
6. [Impact.com](#6-impactcom)
7. [Instagram (Meta Business API)](#7-instagram-meta-business-api)
8. [ManyChat](#8-manychat)
9. [Adding a New Platform](#9-adding-a-new-platform)
10. [Adding a New Creator](#10-adding-a-new-creator)
11. [Troubleshooting Reference](#11-troubleshooting-reference)

---

## 1. Architecture Overview

### How Data Flows

```
┌─────────────────────────────────────────────────────────────┐
│                     DATA SOURCES                            │
│  Amazon · LTK · ShopMy · Mavely · Impact · Instagram       │
└────────────┬────────────────────────────────────────────────┘
             │
     ┌───────┴────────┐
     │  AUTH LAYER     │   (per-platform, detailed below)
     └───────┬────────┘
             │
     ┌───────┴─────────────────────────────────────────┐
     │              SYNC ENGINES                        │
     │                                                  │
     │  Vercel Cron    Railway APScheduler   Local Mac  │
     │  (LTK, ShopMy,  (LTK tokens,         (Amazon    │
     │   IG, Mavely)    Mavely, Impact)       only)     │
     └───────┬─────────────────────────────────────────┘
             │
     ┌───────┴────────┐
     │  Supabase PG    │   platformEarnings, sales, etc.
     └───────┬────────┘
             │
     ┌───────┴────────┐
     │  Next.js App    │   Dashboard, API routes, RBAC
     └────────────────┘
```

### Secret Management

All secrets live in **Doppler**. Three projects:

| Doppler Project | Config | Contains |
|---|---|---|
| `ent-agency-analytics` | `prd` | Amazon cookies/tokens, Google OAuth, Mavely creds |
| `ent-agency-automation` | `prd`/`dev` | Airtable tokens, LTK email/password, CRON_SECRET, Firebase |
| `example-project` | `prd` | Supabase DB_URL, Railway token, Anthropic/OpenAI keys, Webshare proxy |

**Rule**: Never hardcode secrets. Use `doppler run --project X --config prd -- <command>` to inject.

### Database Tables (Shared)

| Table | Used By | Purpose |
|---|---|---|
| `platform_earnings` | All platforms | Monthly/period earnings (revenue, commission, clicks, orders) |
| `sales` | ShopMy, Mavely | Individual transaction records |
| `creators` | All | Master creator records with platform IDs |
| `platform_connections` | All | Dynamic connection state per platform |

---

## 2. Amazon Associates

### Auth Type: **Browser Session Cookies + CSRF Token**

Amazon has no public API. Authentication requires extracting session cookies from a real browser login. Amazon's WAF blocks all datacenter IPs, so sync must run from a residential IP (local Mac or residential proxy).

### Why This Is Hard

- No OAuth, no API keys — purely session-based auth
- WAF blocks Vercel, Railway, and all cloud IPs with HTTP 403
- Cookies expire every 7-14 days
- 2FA (TOTP) required on login
- Device trust token (`x-main`) is long-lived (~1 year) and skips 2FA

### Credential Extraction Flow

```
┌──────────────────────────────────┐
│  amazon-cookie-refresh.py        │
│  (Patchright stealth Playwright) │
├──────────────────────────────────┤
│ 1. Launch headless Chromium      │
│ 2. Navigate to affiliate-program │
│    .amazon.com/home              │
│ 3. Fill email + password         │
│ 4. Handle TOTP 2FA               │
│    (auto via TOTP_SECRET)        │
│ 5. Trust device (sets x-main)    │
│ 6. Extract from page HTML:       │
│    - Cookies (at-main, x-main,   │
│      session-id, ubid-main)      │
│    - Bearer token (JWE from      │
│      associateIdentityToken in   │
│      page source)                │
│    - CSRF token (<meta> tag)     │
│    - Customer ID, Marketplace ID │
│ 7. Save all to Doppler           │
└──────────────────────────────────┘
```

### Secrets (per creator, in `ent-agency-analytics/prd`)

| Secret Name | Value | Lifetime |
|---|---|---|
| `AMAZON_{CREATOR}_EMAIL` | Login email | Permanent |
| `AMAZON_{CREATOR}_PASSWORD` | Login password | Until changed |
| `AMAZON_{CREATOR}_TOTP_SECRET` | Base32 2FA seed | Permanent |
| `AMAZON_{CREATOR}_COOKIES` | Full `Cookie:` header string | ~7-14 days |
| `AMAZON_{CREATOR}_BEARER_TOKEN` | `associateIdentityToken` (JWE) | ~7-14 days |
| `AMAZON_{CREATOR}_CSRF_TOKEN` | From `<meta name="csrf-token">` | ~7-14 days |
| `AMAZON_{CREATOR}_CUSTOMER_ID` | e.g. `A1J742SMH1JPDV` | Permanent |
| `AMAZON_{CREATOR}_MARKETPLACE_ID` | e.g. `ATVPDKIKX0DER` (US) | Permanent |
| `AMAZON_{CREATOR}_AT_MAIN` | `at-main` cookie value | ~7-14 days |
| `AMAZON_{CREATOR}_X_MAIN` | Device trust token | ~1 year |
| `AMAZON_{CREATOR}_SESSION_ID` | `session-id` cookie | ~7-14 days |

### API Headers

```http
GET /reporting/summary?query[start_date]=2026-03-01&query[end_date]=2026-03-31&query[type]=earning&store_id=nickientenman-20 HTTP/1.1
Host: affiliate-program.amazon.com
Authorization: Bearer {BEARER_TOKEN}
X-Csrf-Token: {CSRF_TOKEN}
X-Requested-With: XMLHttpRequest
Cookie: {COOKIES}
customerId: {CUSTOMER_ID}
marketplaceId: {MARKETPLACE_ID}
programId: 1
roles: Primary
storeId: {STORE_TAG}
locale: en_US
```

### API Endpoints

| Endpoint | Returns |
|---|---|
| `GET /reporting/summary?query[type]=earning` | Monthly totals: revenue, commission, clicks, ordered_items |
| `GET /reporting/summary?query[type]=earning&query[group_by]=day` | Daily breakdown (one record per day) |
| `GET /reporting/table` | **BROKEN** — always returns 500, never use |

Response key for both: `records` (array).

### Data Sync Flow

```
Local Mac (8:30am daily via LaunchAgent)
  │
  ├─ doppler run -- python3 tools/amazon-data-sync.py --creator nicki
  │   1. Read cookies/tokens from env vars (Doppler-injected)
  │   2. GET /reporting/summary (monthly) for past N months
  │   3. GET /reporting/summary?group_by=day (daily) for past N days
  │   4. POST all data to Vercel /api/admin/amazon-data-push
  │      (Auth: Bearer {CRON_SECRET})
  │
  └─ Vercel endpoint writes to Supabase:
      - platform_earnings (monthly)
      - amazon_daily_earnings (daily)
      - amazon_orders (per-ASIN, if available)
```

**Why local Mac?** Amazon's WAF blocks datacenter IPs. The local Mac's residential IP passes. Supabase can't be reached directly from local (port restrictions), so we POST to the Vercel endpoint which writes to the DB.

### Cloud Fallback (Railway)

For when the local Mac is unavailable:

```python
# sync-service/sync_amazon.py — two modes:

# Mode 1: Airtop Cloud Browser (residential IP)
# Spins up cloud browser session via AIRTOP_API_KEY
# Full login + token extraction (no stored creds needed)

# Mode 2: Webshare Residential Proxy (44,744 US IPs)
# Uses stored cookies/tokens from Doppler
# Routes requests through random residential proxy
# URL: http://rpeolskt-US-{N}:{pass}@p.webshare.io:{port}
```

### Cookie Health & Auto-Refresh

The `sync-service/amazon_auth.py` module handles session lifecycle:

1. **Health check**: `GET /home/summary` → 200 = valid, 3xx = expired
2. **If session cookies expired + `x-main` present**: Re-login HTTP flow (skips 2FA)
3. **If `x-main` also expired**: Full TOTP + 2FA browser flow required
4. **Save refreshed cookies** back to Doppler

### Adding a New Creator (Amazon)

1. Get Amazon Associates login credentials (email, password, TOTP secret)
2. Get their store tag (e.g. `annschulte-20`)
3. Add secrets to Doppler (`ent-agency-analytics/prd`):
   ```
   AMAZON_ANN_EMAIL=ann@example.com
   AMAZON_ANN_PASSWORD=...
   AMAZON_ANN_TOTP_SECRET=BASE32SECRET
   ```
4. Run cookie refresh: `python3 tools/amazon-cookie-refresh.py --creator ann`
5. Add creator to `amazon-data-sync.py` creator list
6. Update LaunchAgent or add cron entry for daily sync

### Key Files

| File | Purpose |
|---|---|
| `tools/amazon-cookie-refresh.py` | Headless login + cookie extraction (Patchright) |
| `tools/amazon-data-sync.py` | Main data sync (runs locally, POSTs to Vercel) |
| `tools/amazon-daily-sync.py` | Wrapper: credential refresh + sync |
| `sync-service/sync_amazon.py` | Cloud sync fallback (Airtop or Webshare proxy) |
| `sync-service/amazon_auth.py` | Cookie health check + refresh logic |
| `app/api/admin/amazon-data-push/route.ts` | Vercel receiver → Supabase write |
| `app/api/admin/sync-intelligence/route.ts` | Post-sync analysis + Slack alert |
| `lib/amazon.ts` | TypeScript API client (fetchDailyEarnings, fetchMonthlyEarnings) |

---

## 3. LTK (rewardStyle / ShopLTK)

### Auth Type: **Auth0 OAuth via Browser Automation (Airtop + Playwright)**

LTK uses Auth0 for authentication on `creator.shopltk.com`. There is no public API or developer portal. Tokens are extracted by intercepting the Auth0 `/oauth/token` response during a browser login session.

### Why This Is Hard

- No public API or developer portal
- Auth0 tokens are short-lived (~1 hour)
- Requires intercepting network response during login
- Two tokens needed: `access_token` (Bearer) AND `id_token` (separate header)
- Token rotation must happen every ~3 hours to stay ahead of expiration

### Credential Extraction Flow

```
┌───────────────────────────────────┐
│  Railway APScheduler (every 3h)   │
│  job_ltk_token_refresh()          │
├───────────────────────────────────┤
│ 1. Create Airtop browser session  │
│    (free plan: max 3 concurrent)  │
│ 2. Connect via Playwright CDP     │
│ 3. Navigate to creator.shopltk    │
│    .com/login                     │
│ 4. Fill email (LTK_EMAIL) +       │
│    password (LTK_PASSWORD)        │
│ 5. Register response interceptor  │
│    on page.on("response")         │
│ 6. Wait for /oauth/token response │
│ 7. Extract from Auth0 response:   │
│    - access_token (JWT)           │
│    - id_token (JWT)               │
│    - refresh_token                │
│ 8. Decode JWT exp claim           │
│ 9. PATCH Airtable record with     │
│    tokens + Token_Expires_At      │
└───────────────────────────────────┘
```

### Token Storage: Airtable

Tokens are stored in Airtable (not Doppler) for easy rotation:

| Airtable Base | Table | Record |
|---|---|---|
| `appQnKyfyRyhHX44h` | `LTK_Credentials` (`tbl5TEfzBwGPeT1rX`) | One record per creator |

| Field | Purpose |
|---|---|
| `Access_Token` | JWT for `Authorization: Bearer` header |
| `ID_Token` | JWT for `x-id-token` header |
| `Refresh_Token` | Auth0 refresh token (stored for future use) |
| `Last_Refreshed` | Timestamp of last successful refresh |
| `Token_Expires_At` | Expiration (decoded from JWT `exp` claim) |
| `Status` | "active" / "expired" |
| `Consecutive_Failures` | Health monitoring counter |
| `Creator_ID` | Creator identifier for multi-creator lookup |
| `Publisher_ID` | LTK publisher ID (e.g. `293045` for Nicki) |

**Fallback**: If Airtable is unavailable, code falls back to env vars `LTK_ACCESS_TOKEN` + `LTK_ID_TOKEN`.

### API Headers

```http
GET /api/creator-analytics/v1/performance_summary?start_date=2026-03-01T00:00:00Z&end_date=2026-03-14T23:59:59Z&publisher_ids=293045&platform=rs,ltk&timezone=UTC HTTP/1.1
Host: api-gateway.rewardstyle.com
Authorization: Bearer {access_token}
x-id-token: {id_token}
Content-Type: application/json
Origin: https://creator.shopltk.com
Referer: https://creator.shopltk.com/
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...
```

**CRITICAL**: `creator-api-gateway.shopltk.com` is NXDOMAIN — never use it. The correct host is `api-gateway.rewardstyle.com`.

### API Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/creator-analytics/v1/commissions_summary?currency=USD` | Lifetime/open earnings |
| `GET /api/creator-analytics/v1/performance_summary?start_date=...&end_date=...&publisher_ids=...&platform=rs,ltk&timezone=UTC` | Clicks, orders, net_commissions for date range |
| `GET /api/creator-analytics/v1/items_sold/?limit=100&start=...&end=...&currency=USD` | Per-transaction data (cursor-paginated via `meta.next`) |

### Data Sync Flow

```
Two parallel sync paths:

1. Railway (primary):
   job_ltk_data_sync() — daily 6:30 UTC
   ├─ get_ltk_tokens_from_airtable(creator_id)
   ├─ GET /commissions_summary (lifetime earnings)
   ├─ GET /performance_summary (7d + 30d windows)
   └─ Upsert → platform_earnings (direct DB write)

2. Vercel Cron (supplement):
   /api/cron/ltk-sync — daily 6:30 UTC
   ├─ getLTKTokens() from Airtable
   ├─ For each creator with ltkPublisherId:
   │   ├─ fetchLTKPerformanceStats (7d + 30d)
   │   └─ fetchLTKItemsSoldPaginated (all transactions)
   └─ Upsert → platform_earnings + ltkPosts
```

### Adding a New Creator (LTK)

1. Get LTK creator login (email + password)
2. Get their publisher ID (visible in LTK creator dashboard URL)
3. Add secrets to Doppler (`ent-agency-automation/dev`):
   ```
   ANN_LTK_EMAIL=ann@example.com
   ANN_LTK_PASSWORD=...
   ```
4. Create Airtable record in `LTK_Credentials`:
   - `Creator_ID` = `ann_schulte`
   - `Publisher_ID` = `<their publisher ID>`
   - Leave token fields empty (first refresh populates them)
5. Add to `LTK_CREATORS` list in `sync-service/sync_ltk.py`:
   ```python
   {"creator_id": "ann_schulte", "email_env": "ANN_LTK_EMAIL",
    "password_env": "ANN_LTK_PASSWORD", "publisher_id": "<id>"}
   ```
6. Set `ltkPublisherId` on creator record in database

### Key Files

| File | Purpose |
|---|---|
| `lib/ltk.ts` | TypeScript API client + Airtable token fetch |
| `sync-service/sync_ltk.py` | Token refresh (Airtop) + data sync (Railway) |
| `app/api/cron/ltk-sync/route.ts` | Vercel cron sync |
| `app/api/ltk/[...path]/route.ts` | Proxy to LTK API (Clerk-protected, for dashboard) |
| `app/api/admin/ltk-import/route.ts` | Manual CSV import endpoint |

---

## 4. ShopMy

### Auth Type: **Username/Password Session Login (Fresh Each Sync)**

ShopMy is the simplest auth pattern. It uses a standard username/password login that returns HttpOnly session cookies. No token caching or refresh needed — the cron re-authenticates on every run.

### Why This Is Easy

- Standard email/password login endpoint
- Returns session cookies (no OAuth dance)
- No WAF issues — works from Vercel
- No token expiration to manage
- Fresh login on every cron run

### Credential Flow

```
┌──────────────────────────────────┐
│  loginShopMy(email, password)    │
├──────────────────────────────────┤
│ 1. POST /api/Auth/session        │
│    Body: { username, password }  │
│    Headers:                      │
│      x-apicache-bypass: true     │
│      x-session-id: {Date.now()}  │
│      Origin: https://shopmy.us   │
│                                  │
│ 2. Extract Set-Cookie headers:   │
│    - shopmy_session (HttpOnly)   │
│    - shopmy_access_token         │
│      (HttpOnly)                  │
│    - shopmy_csrf_token           │
│      (NOT HttpOnly, UUID inside) │
│                                  │
│ 3. Return ShopMySession:         │
│    { cookieHeader, csrfToken }   │
└──────────────────────────────────┘
```

### Secrets

Stored as Vercel env vars (from Doppler):

| Secret Name | Value |
|---|---|
| `SHOPMY_{CREATOR}_EMAIL` | ShopMy login email |
| `SHOPMY_{CREATOR}_PASSWORD` | ShopMy login password |

Creator mapping in cron route:
```typescript
const creatorCredMap: Record<string, string> = {
  nicki: "SHOPMY_NICKI",   // → SHOPMY_NICKI_EMAIL, SHOPMY_NICKI_PASSWORD
  // sara: "SHOPMY_SARA",
};
```

### API Headers (on every authenticated request)

```http
GET /api/Payouts/payout_summary/{userId} HTTP/1.1
Host: apiv3.shopmy.us
Accept: application/json
x-csrf-token: {csrfToken}
x-session-id: {Date.now()}
x-apicache-bypass: true
User-Agent: Mozilla/5.0 ...
Origin: https://shopmy.us
Referer: https://shopmy.us/
Cookie: shopmy_session=...; shopmy_access_token=...; shopmy_csrf_token=...
```

### API Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/Payouts/payout_summary/{userId}` | `data.payouts[]` (commissions) + `data.months{}` (monthly totals, keys like `"2/28/26"`) |
| `GET /api/Payments/by_user/{userId}` | `payments[]` with `sent_date` (not `sent_at`), amount, source |
| `GET /api/CustomRates/all_rates/{userId}` | Brand commission rates (rate, rate_returning) |

**Gotcha**: Monthly totals are keyed as `"M/D/YY"` strings. Parse to calendar month boundaries.
**Gotcha**: Payment date field is `sent_date`, NOT `sent_at`.
**Gotcha**: Payout data is under `data.payouts`, NOT `normal_commissions`.

### Data Sync Flow

```
Vercel Cron — 7:00 UTC daily
/api/cron/shopmy-sync
  │
  ├─ Query creators WHERE isOwned=true AND shopmyUserId IS NOT NULL
  │
  └─ For each creator:
      1. loginShopMy(email, password) → fresh session
      2. Parallel fetch:
         ├─ fetchPayoutSummary → payouts[] + months{}
         ├─ fetchPayments → payments[]
         └─ fetchBrandRates → rates[]
      3. Write to DB:
         ├─ payouts[] → sales table
         ├─ months{} → platform_earnings table
         ├─ payments[] → shopmy_payments table
         └─ rates[] → shopmy_brand_rates table
```

### Adding a New Creator (ShopMy)

1. Get ShopMy login credentials
2. Get their ShopMy user ID (from the ShopMy dashboard URL)
3. Add env vars to Vercel (via Doppler):
   ```
   SHOPMY_SARA_EMAIL=sara@example.com
   SHOPMY_SARA_PASSWORD=...
   ```
4. Uncomment/add to `creatorCredMap` in cron route:
   ```typescript
   sara: "SHOPMY_SARA",
   ```
5. Set `shopmyUserId` on creator record:
   ```
   PATCH /api/admin/set-creator-platform-ids
   { "creatorId": "sara_preston", "shopmyUserId": "12345" }
   ```

### Key Files

| File | Purpose |
|---|---|
| `lib/shopmy.ts` | Auth + API client (loginShopMy, shopmyFetch, fetch functions) |
| `app/api/cron/shopmy-sync/route.ts` | Main cron sync (7am UTC) |
| `app/api/admin/shopmy-verify/route.ts` | Verify sync health |
| `app/api/admin/shopmy-reset/route.ts` | Clear ShopMy data for re-sync |

---

## 5. Mavely

### Auth Type: **NextAuth Credentials Flow (Session Cookie → JWT)**

Mavely uses a NextAuth-based login on `creators.mave.ly`. Authentication is a three-step cookie exchange, then all data is fetched via GraphQL.

### Credential Flow

```
┌──────────────────────────────────────┐
│  Mavely Auth (3-step cookie flow)    │
├──────────────────────────────────────┤
│ 1. GET /api/auth/csrf                │
│    → CSRF token + __Host-next-auth   │
│      cookies                         │
│                                      │
│ 2. POST /api/auth/callback/          │
│    credentials                       │
│    Body: { email, password,          │
│            csrfToken, json: true }   │
│    → Session cookies set             │
│                                      │
│ 3. GET /api/auth/session             │
│    → { accessToken: "JWT..." }       │
│    This JWT is used for GraphQL      │
└──────────────────────────────────────┘
```

### Secrets

| Secret | Location |
|---|---|
| `MAVELY_EMAIL` | Doppler `ent-agency-analytics/prd` |
| `MAVELY_PASSWORD` | Doppler `ent-agency-analytics/prd` |

### GraphQL API

**Base URL**: `https://mavely.live`

Required headers:
```http
Authorization: Bearer {jwt_from_session}
client-name: @mavely/creator-app
client-version: 1.4.2
Content-Type: application/json
```

**Queries**:
- `creatorAnalyticsMetricsByEntity` — Per-link metrics (clicks, orders, commission, revenue). Paginated, 100/page. Entity type: `LINK`.
- `allReports` — Individual transactions. Cursor-based pagination. Fields: transaction ID, sale date, commission, order value, status.

### Data Sync

Railway APScheduler: `job_mavely_sync` at 8:00 UTC daily.

Writes to: `mavely_links`, `mavely_transactions`, `platform_earnings` (monthly aggregates).

### Adding a New Creator (Mavely)

1. Get Mavely creator login credentials
2. Get their Mavely creator ID
3. Add env vars to Doppler:
   ```
   MAVELY_{CREATOR}_EMAIL=...
   MAVELY_{CREATOR}_PASSWORD=...
   ```
4. Add to creator list in `sync-service/sync_mavely.py`
5. Set `mavelyCreatorId` on creator record in database

### Key Files

| File | Purpose |
|---|---|
| `lib/mavely-graphql.ts` | TypeScript GraphQL client + auth |
| `sync-service/sync_mavely.py` | Python sync (Railway) |
| `app/api/cron/mavely-sync/route.ts` | Vercel cron |
| `app/api/cron/mavely-graphql-sync/route.ts` | Vercel GraphQL sync |

---

## 6. Impact.com

### Auth Type: **HTTP Basic Auth (Account SID + Auth Token)**

The simplest auth pattern in the system. Impact.com provides proper API credentials via their dashboard. Standard HTTP Basic Auth, no cookies, no browser automation.

### Credential Flow

```
┌──────────────────────────────────┐
│  Impact.com Auth                 │
├──────────────────────────────────┤
│ 1. Creator logs into             │
│    app.impact.com                │
│ 2. Settings → API →             │
│    Account SID + Auth Token      │
│ 3. Store in Doppler as:          │
│    IMPACT_{CREATOR}_ACCOUNT_SID  │
│    IMPACT_{CREATOR}_AUTH_TOKEN   │
│ 4. Use HTTP Basic Auth:          │
│    Authorization: Basic          │
│    base64(SID:Token)             │
└──────────────────────────────────┘
```

### API

**Base URL**: `https://api.impact.com`

```http
GET /Mediapartners/{AccountSID}/Reports/mp_action_listing_sku.json?START_DATE=2026-03-01&END_DATE=2026-03-14&SUPERSTATUS_MS=APPROVED HTTP/1.1
Host: api.impact.com
Authorization: Basic {base64(SID:Token)}
```

Response: paginated `Records[]` with sale amount, payout, status, SKU. Pagination via `@nextpageuri`.

### Data Sync

Railway APScheduler: `job_impact_sync` at 9:30 UTC daily.
Writes to: `platform_earnings` (monthly aggregates, `platform='impact'`).
Graceful skip: if creator is missing API credentials, logs warning and continues.

### Adding a New Creator (Impact.com)

1. Creator retrieves Account SID + Auth Token from `app.impact.com → Settings → API`
2. Add to Doppler:
   ```
   IMPACT_ANN_ACCOUNT_SID=...
   IMPACT_ANN_AUTH_TOKEN=...
   ```
3. Add to `IMPACT_CREATORS` list in `sync-service/sync_impact.py`

### Key Files

| File | Purpose |
|---|---|
| `sync-service/sync_impact.py` | Full sync implementation |
| `sync-service/main.py` | Scheduler config |

---

## 7. Instagram (Meta Business API)

### Auth Type: **Meta App OAuth 2.0 (Long-Lived Page Tokens)**

This is the only platform with proper OAuth. Creators authorize the Meta app, which returns a short-lived token that's exchanged for a long-lived one (~60 days). Tokens are stored in the `creatorTokens` table.

### OAuth Flow

```
┌──────────────────────────────────────────────┐
│  Instagram OAuth Flow                        │
├──────────────────────────────────────────────┤
│ 1. Creator clicks "Connect Instagram"        │
│    → Redirects to Meta OAuth consent          │
│                                              │
│ 2. Meta redirects back with ?code=...        │
│    → /api/auth/instagram/callback            │
│                                              │
│ 3. Exchange code for short-lived token:      │
│    POST /oauth/access_token                  │
│    → { access_token (short, ~1h) }           │
│                                              │
│ 4. Exchange short for long-lived:            │
│    GET /oauth/access_token?grant_type=       │
│    fb_exchange_token&fb_exchange_token=...    │
│    → { access_token (long, ~60 days) }       │
│                                              │
│ 5. Get Instagram Business Account:           │
│    GET /me/accounts → find page →            │
│    page.instagram_business_account.id        │
│                                              │
│ 6. Store in creatorTokens table:             │
│    { clerkUserId, creatorId, igUserId,       │
│      accessToken, expiresAt }                │
└──────────────────────────────────────────────┘
```

### Secrets

| Secret | Location |
|---|---|
| `META_APP_ID` | Vercel env |
| `META_APP_SECRET` | Vercel env |

### API Endpoints

**Base URL**: `https://graph.facebook.com/v21.0`

| Endpoint | Returns |
|---|---|
| `GET /{igUserId}?fields=followers_count,media_count,...` | Profile metadata |
| `GET /{igUserId}/media?fields=caption,timestamp,like_count,...` | Media feed |
| `GET /{mediaId}/insights?metric=reach,saved,shares,views` | Per-post engagement |
| `GET /{igUserId}/stories` | Active stories (24h window) |

### Data Sync

- `/api/cron/collect` — Daily media + profile snapshots (6:30 UTC)
- `/api/cron/collect-stories` — Story metrics (every 6 hours)
- `/api/cron/refresh-token` — Token refresh before expiration
- `/api/cron/caption-analyze` — AI caption scoring (SEO, hooks, CTA)

### Adding a New Creator (Instagram)

1. Creator clicks "Connect Instagram" in the dashboard
2. OAuth flow completes automatically
3. Token stored in `creatorTokens` table
4. Cron jobs automatically pick up new creators with valid tokens

### Key Files

| File | Purpose |
|---|---|
| `lib/instagram.ts` | IG API client + affiliate URL extraction from captions |
| `app/api/auth/instagram/callback/route.ts` | OAuth callback handler |
| `app/api/cron/collect/route.ts` | Daily media collection |
| `app/api/cron/collect-stories/route.ts` | 6-hour story collection |
| `app/api/cron/refresh-token/route.ts` | Token refresh |

---

## 8. ManyChat

### Auth Type: **Shared Secret (Webhook)**

ManyChat is inbound-only. It POSTs webhook events to our endpoint when Instagram comment/DM automations fire. No outbound API calls.

### Flow

```
Instagram Comment ("SHOP")
  → ManyChat Flow triggers
    → External Request POST to /api/webhooks/manychat
      → Header: x-manychat-secret: {CRON_SECRET}
      → Body: { event_type, creator_id, keyword, subscriber_ig, ... }
        → Insert into manychat_events table
```

### Key File

| File | Purpose |
|---|---|
| `app/api/webhooks/manychat/route.ts` | Webhook receiver |

---

## 9. Adding a New Platform

Follow this pattern to integrate any new affiliate platform:

### Step 1: Determine Auth Type

| Auth Pattern | Complexity | Examples |
|---|---|---|
| API Key / Basic Auth | Low | Impact.com |
| Username/Password Session | Medium | ShopMy |
| OAuth 2.0 | Medium | Instagram |
| NextAuth/Session Cookie | Medium-High | Mavely |
| Auth0 Browser Intercept | High | LTK |
| Browser Cookie Extraction | Highest | Amazon |

### Step 2: Create API Client (`lib/{platform}.ts`)

```typescript
// Minimum interface:
interface PlatformSession {
  // Whatever auth tokens/cookies are needed
}

export async function login(email: string, password: string): Promise<PlatformSession> {
  // Auth flow
}

export async function fetchEarnings(session: PlatformSession, startDate: string, endDate: string) {
  // Return { revenue, commission, clicks, orders }
}
```

### Step 3: Create Cron Route (`app/api/cron/{platform}-sync/route.ts`)

```typescript
import { NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // 1. Verify CRON_SECRET
  // 2. Get creators with this platform configured
  // 3. For each: login → fetch → upsert platform_earnings
  // 4. Return results
}
```

### Step 4: Add to Database

- Set platform ID on creator record (e.g. `platformUserId` column)
- Upsert earnings into `platform_earnings` with `platform = '{name}'`
- Add platform-specific tables if needed (e.g. `shopmy_payments`)

### Step 5: Add Secrets

- Store credentials in Doppler (per-creator pattern: `{PLATFORM}_{CREATOR}_{FIELD}`)
- Add to Vercel env vars if running on Vercel cron
- Add to Railway env if running on Railway

### Step 6: Add to Vercel Cron Schedule (`vercel.json`)

```json
{ "path": "/api/cron/{platform}-sync", "schedule": "0 8 * * *" }
```

---

## 10. Adding a New Creator (All Platforms)

### Checklist

1. **Database**: Add to `CREATORS` array in `lib/creators.ts` with `isOwned: true`
2. **Per platform** (only platforms the creator uses):

| Platform | Credential Source | Storage | Config Step |
|---|---|---|---|
| Amazon | Email + password + TOTP secret | Doppler `ent-agency-analytics` | Run `amazon-cookie-refresh.py --creator {name}` |
| LTK | Email + password + publisher ID | Doppler `ent-agency-automation` + Airtable record | Add to `LTK_CREATORS` in `sync_ltk.py` |
| ShopMy | Email + password + user ID | Vercel env vars | Add to `creatorCredMap` + set `shopmyUserId` |
| Mavely | Email + password + creator ID | Doppler `ent-agency-analytics` | Add to creator list in `sync_mavely.py` |
| Impact | Account SID + Auth Token | Doppler env vars | Add to `IMPACT_CREATORS` in `sync_impact.py` |
| Instagram | Self-service OAuth | `creatorTokens` table (auto) | Creator clicks "Connect Instagram" |

---

## 11. Troubleshooting Reference

### Amazon

| Issue | Cause | Fix |
|---|---|---|
| 403 from Amazon API | WAF blocking datacenter IP | Must run from local Mac or residential proxy |
| Cookies expired | Session cookies are ~7-14 days | Run `amazon-cookie-refresh.py` |
| 2FA required despite TOTP | `x-main` device trust expired | Full browser login with TOTP |
| `/reporting/table` returns 500 | Endpoint is permanently broken | Use `/reporting/summary` with `group_by=day` instead |

### LTK

| Issue | Cause | Fix |
|---|---|---|
| 403 Key Not Authorised | Tokens expired (>1h old) | Manual trigger: `POST /sync/ltk-tokens` on Railway |
| No id_token in intercept | Login form didn't complete | Check Airtop session logs, verify LTK_PASSWORD |
| Airtable 422 error | Invalid datetime field | Ensure `Token_Expires_At` is ISO format |
| `creator-api-gateway.shopltk.com` NXDOMAIN | Wrong hostname | Use `api-gateway.rewardstyle.com` |

### ShopMy

| Issue | Cause | Fix |
|---|---|---|
| Login fails | Password changed | Update `SHOPMY_{CREATOR}_PASSWORD` in Vercel env |
| Missing payout data | Wrong response key | Use `data.payouts`, not `normal_commissions` |
| Wrong payment date | Wrong field name | Use `sent_date`, not `sent_at` |

### Mavely

| Issue | Cause | Fix |
|---|---|---|
| CSRF token invalid | Session expired mid-sync | Retry — fresh login on each sync |
| GraphQL auth error | JWT expired | Re-run auth flow (3-step cookie exchange) |

### Impact.com

| Issue | Cause | Fix |
|---|---|---|
| 401 Unauthorized | Bad SID or Token | Creator re-generates from `app.impact.com → Settings → API` |
| Missing creator data | No env vars set | Gracefully skipped — add `IMPACT_{CREATOR}_ACCOUNT_SID` + `AUTH_TOKEN` |

---

## Auth Pattern Comparison

| Platform | Auth Method | Token Lifetime | Storage | Refresh Method | WAF Issues | Complexity |
|---|---|---|---|---|---|---|
| Amazon | Browser cookies + CSRF | ~7-14 days | Doppler | Patchright headless login | Yes (datacenter blocked) | Highest |
| LTK | Auth0 browser intercept | ~1 hour | Airtable | Airtop + Playwright (3h) | No | High |
| ShopMy | Email/password session | Per-request | None (fresh each sync) | N/A (login every time) | No | Low |
| Mavely | NextAuth 3-step cookie | Session-length | None (fresh each sync) | N/A (login every time) | No | Medium |
| Impact | HTTP Basic Auth (SID/Token) | Permanent | Doppler | N/A (doesn't expire) | No | Lowest |
| Instagram | Meta OAuth 2.0 | ~60 days | `creatorTokens` table | Long-lived token exchange | No | Medium |
| ManyChat | Shared secret (inbound) | Permanent | Vercel env | N/A | No | Lowest |
