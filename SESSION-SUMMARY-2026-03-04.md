# Session Summary — 2026-03-04

## What Was Built

### Railway Sync Service (`sync-service/`)
Replaced n8n-based LTK and Mavely sync with a standalone Python service deployed on Railway.

**URL:** `https://exemplary-analysis-production.up.railway.app`
**Project:** `kind-connection` (ID: `3049136c-fc4d-4ee4-bf1c-db6c664c303a`)
**Service:** `exemplary-analysis` (ID: `b28d7c36-70b2-4589-a1b7-0f4ec7b1074a`)

#### Scheduled Jobs
| Job | Schedule | What it does |
|-----|----------|-------------|
| `ltk_token_refresh` | Every 3h | Airtop browser → creator.shopltk.com → extracts Auth0 tokens → writes to Airtable |
| `ltk_data_sync` | 6:30 UTC daily | Fetches 7d + 30d performance from LTK API → `platform_earnings` |
| `mavely_sync` | 8:00 UTC daily | Fetches 90d link metrics from Mavely GraphQL → `mavely_links` + `platform_earnings` |

#### Manual Triggers (requires `Authorization: Bearer $SYNC_RAILWAY_SECRET`)
- `POST /sync/mavely` — Mavely sync
- `POST /sync/ltk` — LTK data sync
- `POST /sync/ltk-tokens` — LTK token refresh via Airtop
- `GET /health` — Health check + next run times
- `GET /` — Admin UI with trigger buttons

#### Secrets
- `SYNC_RAILWAY_SECRET` in Doppler (`ent-agency-automation/dev`)
- Railway env vars: `DATABASE_URL`, `AIRTOP_API_KEY`, `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `LTK_EMAIL`, `LTK_PASSWORD`, `MAVELY_EMAIL`, `MAVELY_PASSWORD`, `SYNC_SECRET`

---

## What Was Fixed

### LTK Broken (403 Key Not Authorised)
- Root cause: n8n workflow `zoqNMIxIaSxFWaGm` was updating `Last_Refreshed` but writing stale tokens
- JWT decode confirmed tokens expired March 1 (~62h stale)
- Auth0 refresh_token was invalidated by repeated failed n8n attempts
- Fix: Manual Airtop session → fresh tokens → confirmed LTK sync working

### UI Theming (prior session, deployed this session)
- Installed `next-themes`, created `globals.css` with CSS variables for light/dark
- `ThemeProvider` + `ThemeToggle` components
- `MetricCard`, `PlatformCard`, `PostGrid` updated to CSS variable classes
- Instagram-style grid: `aspect-[4/5]` reels, `gap-[2px]`

---

## Bugs Fixed in Railway Service (during this session)

| Bug | Fix |
|-----|-----|
| `httpx.QueryParams` has no `.encode()` | Switched to `urllib.parse.urlencode` |
| asyncpg rejects string dates for `DATE` columns | Pass `datetime.date` objects |
| Supabase PgBouncer breaks prepared statements | `statement_cache_size=0` on connect |
| New DB connection per `execute()` call (very slow) | Single connection reused per sync run |
| HTTP endpoints block until sync completes (timeout) | Fire-and-forget via `asyncio.create_task` |
| 5000 individual inserts (8+ min) | `executemany` batch inserts |
| `mavely_transactions` schema mismatch | Skipped — legacy schema from migration 0002; dashboard uses `platform_earnings` only |

---

## Current Data Flow

```
Nicki's platforms:
  LTK        → Railway (token refresh every 3h + data sync 6:30 UTC) → platform_earnings
  ShopMy     → Vercel cron /api/cron/shopmy-sync (7:00 UTC)          → platform_earnings
  Mavely     → Railway (8:00 UTC)                                     → mavely_links + platform_earnings
  Instagram  → Vercel cron /api/cron/collect (6:00 UTC)              → media_snapshots
  IG Stories → Vercel cron /api/cron/collect-stories (every 6h)      → stories_snapshots

All → Supabase Postgres (jidfewontxspgylmtavp)
     → Next.js dashboard at creator-metrics.vercel.app
```

---

## n8n Workflows That Can Now Be Disabled
- `zoqNMIxIaSxFWaGm` — LTK token refresh (replaced by Railway every-3h job)
- `3gYfgPzMu6wZ1OEZ` — Mavely Airtable write (replaced by Railway Mavely sync)

## Vercel Crons That Can Be Removed
- `/api/cron/mavely-sync` (was Airtable-based n8n flow) — Railway handles this now

---

## Pending / Known Issues
- `mavely_transactions` table has legacy schema (migration 0002) — needs a new migration to add `creator_id` and match the 0004 schema before per-transaction insert can be re-enabled
- Amazon sync: schema ready (`amazon_earnings`), no sync built — needs Airtop auth at `affiliate-program.amazon.com`
- Railway service name is `exemplary-analysis` (auto-generated) — consider renaming to `creator-metrics-sync`
- Emily Ogan (`livefitwithem`) — earnings syncs target `nicki_entenmann` only; multi-creator support not yet built
