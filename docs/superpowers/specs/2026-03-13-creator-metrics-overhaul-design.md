# Creator Metrics Overhaul — Design Spec
**Date:** 2026-03-13
**Status:** Approved
**Scope:** Date-range filtering, creator scoping, platform sync accuracy, Motion-style content attribution cards

---

## What We're Building

A complete overhaul of creator-metrics.vercel.app to make it actually usable day-to-day as an internal tool. Two major pillars:

1. **Global creator + date filter** wired to every page via URL params — pick a creator, pick a date range, everything reflects that selection accurately
2. **Motion-style content cards page** — Instagram posts as visual cards showing which affiliate links they had and how much revenue they drove

---

## Architecture

### Global Filter State: URL Params

Filters live in the URL as query params:
```
/dashboard/earnings?creator=nicki_entenmann&preset=30d&start=2026-02-10&end=2026-03-12
```

- `preset`: `7d | 30d | 90d | this-month | last-month | ytd | custom`
- `start` + `end`: always written to URL (even for presets) for shareability
- A single `useFilters()` hook reads `useSearchParams()` and exposes `{ creator, preset, startDate, endDate, setCreator, setDateRange }`
- Filter changes call `router.push()` — no other state management needed
- Invalid params fall back silently to defaults (30D, first creator)

### Filter Bar in Layout

Lives in `app/dashboard/layout.tsx` — renders sticky above every dashboard page automatically. Contains:
- **CreatorSelector** — dropdown of all 21 creators
- **DateRangePicker** — preset chips (7D, 30D, 90D, This Month, Last Month, YTD, Custom) + resolved date label
- **Staleness indicator** — "Synced X ago", amber >1d, red >2d

### All API Routes Accept `creatorId + startDate + endDate`

No API call runs without creator scope. Every route uses these params in DB queries.

---

## Platform Date Handling

All platforms are **day-accurate** (confirmed via API testing). No monthly-bucket fallback needed.

| Platform | Granularity | Implementation |
|----------|-------------|----------------|
| Mavely | Transaction-level | `WHERE sale_date BETWEEN $start AND $end` on `mavely_transactions` |
| ShopMy | Transaction-level | `WHERE sale_date BETWEEN $start AND $end` on `sales` |
| LTK | Day-accurate | Pass exact dates to `performance_summary` API + paginate `items_sold` with cursor loop |
| Amazon | Day-accurate | Change `period_start`/`period_end` from calendar-month to selected range (2-line fix in `sync_amazon_local.py`) |
| Impact.com | Monthly (1 creator) | Query overlapping months from `platform_earnings`, labeled clearly |

**LTK pagination:** `items_sold` is cursor-paginated. Current code fetches only page 1 (silently truncates at 100 items). Fix: loop on `meta.next` until null.

**LTK API date format:** ISO 8601 with milliseconds — `YYYY-MM-DDTHH:MM:SS.000Z`

---

## Content Cards Page (Motion-Style)

### New Page: `/dashboard/content`

Instagram posts displayed as a visual card grid. Each card shows:
- **Post thumbnail** (from `media_snapshots.media_url` / `thumbnail_url`)
- **Platform tags** overlaid: Mavely (purple) / ShopMy (pink) / LTK (amber) / Amazon (black) / No link (gray)
- **Revenue badge** top-right corner (green = has revenue)
- **Metrics below**: Reach, Likes/Comments, Orders, Revenue
- **Affiliate link** shown at bottom of card with → sale count

**Gradient placeholder** used when no thumbnail available (per content type).

### Filter Bar (Content Page)

- Content type: All | Reels | Posts | Stories
- Platform: All | Mavely | ShopMy | LTK | Amazon | Has Link
- Sort by: Revenue | Reach | Engagement | Date

### Attribution Matching Logic

For each post in `media_snapshots`, match `linkUrl` to affiliate platform:

| Platform | URL Pattern | Join Target |
|----------|------------|-------------|
| Mavely | `go.mvly.co/*` or `mavely.com/*` | `mavely_links` on URL match |
| LTK | `liketk.it/*` or `ltk.com/*` | `ltk_posts` on `rs_url` match |
| ShopMy | `shopmy.co/*` or `shop.shopmy.co/*` | `shopmy_opportunity_commissions` by date window |
| Amazon | `amzn.to/*` or `amazon.com/shop/*` | `platform_earnings` by date (storefront = all Amazon revenue for that day) |

Multi-platform posts (post has links to 2+ platforms) → show multiple tags, split revenue.

### New API Route: `GET /api/creators/[id]/content`

Params: `startDate`, `endDate`, `type` (reel/post/story), `platform`

Returns: array of posts with `{ mediaIgId, postedAt, type, thumbnailUrl, linkUrl, platform, reach, likes, comments, views, attributedRevenue, affiliateLink, orders }`

---

## Components Built / Modified

| Component | Type | Description |
|-----------|------|-------------|
| `hooks/useFilters.ts` | NEW | Reads URL params, exposes setCreator + setDateRange |
| `app/dashboard/layout.tsx` | MODIFIED | Add sticky filter bar |
| `components/DateRangePicker.tsx` | NEW | Preset chips + custom calendar |
| `components/CreatorSelector.tsx` | NEW/MODIFIED | Creator dropdown wired to useFilters |
| `app/dashboard/content/page.tsx` | NEW | Content cards page |
| `components/PostCard.tsx` | NEW | Individual post card with attribution |
| All `/api/creators/[id]/*` routes | MODIFIED | Accept + enforce creatorId + date range params |
| `app/api/creators/[id]/content/route.ts` | NEW | Content + attribution API |
| `sync-service/sync_amazon_local.py` | MODIFIED | Use exact date range instead of calendar month |
| `lib/ltk.ts` — `fetchLTKItemsSold` | MODIFIED | Add cursor pagination loop |
| `app/api/cron/ltk-sync/route.ts` | MODIFIED | Pass exact dates to LTK API |

---

## Error Handling

- **Sync failure** → staleness badge (amber >1d, red >2d), Slack alert, last good data shown
- **Bad URL params** → silent fallback to defaults, never 500
- **No data for range** → empty state card per platform, not an error
- **LTK 401** → catch in sync job, Slack alert, token rotation runs every 3h to prevent
- **Missing thumbnail** → gradient placeholder by content type
- **Attribution miss** → "No link" card state, revenue shown as "—"

---

## Testing

### Unit Tests
- `useFilters()` — preset derivation, custom range parsing, bad param fallback
- Attribution URL matching — all platform patterns, multi-platform, edge cases
- DB query builders — correct WHERE clauses, LTK pagination loop termination

### Integration Tests
- Each platform API route returns correct data for known date range
- Empty range returns `[]` not error
- `creatorId` scoping verified (no cross-creator data leakage)

### Manual Smoke Tests
- Select Nicki + 30D → all platform cards populated
- Switch creator → data changes correctly
- Custom range → correct dates in URL and data
- LTK totals match LTK dashboard for same date range
- Mavely totals match Mavely dashboard for same date range

---

## What's Not In Scope (This Iteration)

- Per-creator auth logins (full SaaS RBAC) — internal tool only
- Impact.com multi-creator expansion — only 1 creator active, low priority
- Amazon Railway sync reliability — Mac cron is primary, acceptable for now
- LTK per-post archive (endpoint unknown) — future investigation
