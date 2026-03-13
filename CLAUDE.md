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

## ShopMy API

Session endpoint: `POST /api/Auth/session` → returns cookies (`shopmy_session`, `shopmy_access_token`, `shopmy_csrf_token` — all HttpOnly except csrf)
Required headers: `x-apicache-bypass: true`, `x-csrf-token: {csrfToken}`, `x-session-id: {timestamp}`

Data structure:
- Payout data: `data.payouts` (NOT `normal_commissions`)
- Monthly totals: `data.months` (keys like "2/28/26")
- Payments: `GET /api/Payments/by_user/{userId}` → `payments[].sent_date` (not `sent_at`)

Vercel env: `SHOPMY_NICKI_EMAIL` / `SHOPMY_NICKI_PASSWORD`
