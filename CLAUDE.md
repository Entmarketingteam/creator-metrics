# creator-metrics — Technical Reference

## LTK API

Base URL: `https://api-gateway.rewardstyle.com`
Headers: `Authorization: Bearer {access_token}` + `x-id-token: {id_token}` + `Origin: https://creator.shopltk.com` + `Referer: https://creator.shopltk.com/`

Endpoints:
- `GET /api/creator-analytics/v1/commissions_summary?currency=USD` — lifetime/open earnings
- `GET /api/creator-analytics/v1/performance_summary?start_date=...&end_date=...&publisher_ids=293045&platform=rs,ltk&timezone=UTC` — clicks/orders/net_commissions
- `GET /api/creator-analytics/v1/items_sold/?limit=100&start=...&end=...&currency=USD` — per-transaction

**Note:** `creator-api-gateway.shopltk.com` is NXDOMAIN — never use it.

Credentials: `op item get qfr2fxyi2cvp3rq4xk7xxosglu --reveal` (1Password Shared, nicki.entenmann@gmail.com)
Manual refresh script: `/tmp/ltk_refresh_playwright.py` — needs `AIRTOP_API_KEY`, `AIRTABLE_KEY` (=AIRTABLE_TOKEN from Doppler), `LTK_EMAIL`, `LTK_PASSWORD`

## Amazon Associates API

Base URL: `https://affiliate-program.amazon.com`
Required headers: `Authorization: Bearer {associateIdentityToken}` + `X-Csrf-Token` + `X-Requested-With: XMLHttpRequest` + `customerid` + `marketplaceid` + `programid` + `roles` + `storeid` + `Cookie`

Endpoints:
- `GET /reporting/summary?query[start_date]=...&query[end_date]=...&query[type]=earning&store_id={tag}` — monthly totals (revenue, commission, clicks, ordered_items). Response key: `records`.
- `GET /reporting/summary?query[type]=earning&query[group_by]=day&...` — daily breakdown (one record per day with `day` field). Response key: `records`.
- `/reporting/table` — **always returns HTTP 500**, do not use.

**WAF NOTE**: Amazon blocks Vercel/Railway datacenter IPs (403). All Amazon API calls must run from the local Mac.

**DB WRITE**: Local Mac can't reach Supabase ports directly. Sync script POSTs to `POST /api/admin/amazon-data-push` on Vercel instead, which writes to Supabase. Auth: `CRON_SECRET` from `ent-agency-automation/dev`.

Cookie refresh: `python3 tools/amazon-cookie-refresh.py --creator nicki`
Data sync: `python3 tools/amazon-data-sync.py --creator nicki --months 12 --days 90`

LaunchAgent: `com.entagency.amazon-data-sync` — runs `amazon-data-sync.py` at 8:30am daily

Doppler secrets per creator (prefix `AMAZON_{CREATOR}_`):
- `COOKIES` — full Cookie header string
- `BEARER_TOKEN` — `associateIdentityToken` JWE from `/home/reports` page HTML
- `CSRF_TOKEN` — from `<meta name="csrf-token">` in `/home/reports`
- `CUSTOMER_ID` — e.g. `A1J742SMH1JPDV`
- `MARKETPLACE_ID` — e.g. `ATVPDKIKX0DER` (US)

Vercel cron `/api/cron/amazon-sync` is a status-only no-op (WAF blocks it from calling Amazon).

## ShopMy API

Session endpoint: `POST /api/Auth/session` → returns cookies (`shopmy_session`, `shopmy_access_token`, `shopmy_csrf_token` — all HttpOnly except csrf)
Required headers: `x-apicache-bypass: true`, `x-csrf-token: {csrfToken}`, `x-session-id: {timestamp}`

Data structure:
- Payout data: `data.payouts` (NOT `normal_commissions`)
- Monthly totals: `data.months` (keys like "2/28/26")
- Payments: `GET /api/Payments/by_user/{userId}` → `payments[].sent_date` (not `sent_at`)

Vercel env: `SHOPMY_NICKI_EMAIL` / `SHOPMY_NICKI_PASSWORD`
