# Amazon Affiliate Sync — Implementation Plan
**Date:** 2026-03-12 (updated after API research)
**Status:** Ready to implement — two viable paths
**Priority:** High — last missing platform for Nicki's full earnings dashboard

---

## Hard Reality: There Is No Amazon Earnings API

| What we tried / researched | Verdict |
|---------------------------|---------|
| Playwright + TOTP 2FA | Killed by bot detection |
| Playwright + stealth | Still flagged |
| Stored session cookies | Works but expires; manual re-extraction needed |
| Amazon Creators API (`creatorsapi::default`) | **Product search API only** — zero earnings data |
| S3 Data Feed (bulk export) | **Deprecated Jan 31, 2026** — already gone |
| PA-API credentials from Associates dashboard | Product lookup only; also deprecated Apr 30, 2026 |
| Any future earnings API | Amazon keeps promising one; nothing exists as of March 2026 |

**Amazon's official position:** There is no programmatic earnings API for the Associates program. This has been the case for years and has not changed with the Creators API launch.

The credentials Nicki can generate in her Associates Central dashboard are PA-API keys (product search) — not useful for earnings.

---

## Two Paths That Can Actually Work

---

### Path A: Manual CSV Upload (Recommended — Build This First)

**How it works:** Amazon lets you export a CSV from Associates Central manually. Build a drag-and-drop upload page in creator-metrics. Creator uploads it once a month. System parses and stores it.

**Why this is the right call:**
- Zero Amazon auth complexity
- No cookies to expire
- No bot detection
- Amazon's own export format is reliable
- Takes ~30 seconds for a creator to do monthly
- Same data you'd get from any API anyway

**Files to build:**

```
app/dashboard/earnings/upload/page.tsx        # Upload UI — drag & drop CSV
app/api/earnings/amazon-upload/route.ts       # Parse CSV + upsert to DB
lib/amazon-csv.ts                             # CSV parser (see format below)
```

**Amazon Associates CSV format** (from Reports > Earnings Report):
```csv
Date,Clicks,Ordered Items,Shipped Items,Returns,Shipped Revenue,Shipped Earnings,...
2026-02-01,45,3,3,0,"$147.50","$8.85",...
```

Key columns: `Date`, `Clicks`, `Ordered Items`, `Shipped Items`, `Shipped Revenue`, `Shipped Earnings`

**Upsert logic:**
- Parse each row → insert into `platform_earnings` with `platform = 'amazon'`
- Use `period_start = date`, `period_end = date` (daily rows)
- On conflict: update (idempotent re-uploads are fine)

**UI:** Add an "Upload Amazon Report" button on the earnings page, visible only for creators where `platform = amazon`. Keep it simple — file input + upload button, show "X rows imported."

---

### Path B: Stored Cookies Refresh (Automated — Build This Second)

The last working approach (`commit 3ac49e5`) used stored cookies to download the CSV programmatically. It worked. The problem was cookies expiring with no alert.

**Fix: add a cookie health check + Slack alert.**

**How it works:**
1. Nicki or Ethan runs `extract_amazon_cookies.py` locally once (takes ~2 min — just logs in via browser script)
2. Cookie string saved to Doppler as `AMAZON_NICKI_COOKIES`
3. Daily cron downloads CSV via HTTP using stored cookies
4. If cookies expired (redirect to login page detected) → post Slack alert with instructions to re-extract

**Files to build:**

```
sync-service/extract_amazon_cookies.py        # Already exists at commit 3ac49e5
app/api/cron/amazon-sync/route.ts             # Daily cron (see commit 3ac49e5 for Python version)
lib/amazon.ts                                  # Cookie-based HTTP download + CSV parse
```

**Cookie health check in cron:**
```typescript
// After fetching, check if we got the login page instead of CSV
if (responseText.includes('ap/signin') || responseText.includes('Sign in to your account')) {
  await notifySlack('⚠️ Amazon cookies expired for Nicki — re-run extract_amazon_cookies.py');
  return NextResponse.json({ error: 'cookies_expired' }, { status: 200 }); // 200 so cron doesn't retry
}
```

**Cookie lifespan:** Amazon session cookies typically last 3–6 months. With an alert, re-extraction is a 2-minute task.

**Doppler secrets needed:**
```
AMAZON_NICKI_COOKIES = "session-id=...; session-id-time=...; ubid-main=...; ..."
```

---

## Recommendation: Build Path A First

Path A (CSV upload) takes ~2 hours to build and gives you reliable data with zero Amazon auth headaches. It's also how most serious affiliate analytics tools actually work under the hood.

Path B (stored cookies) takes longer and requires Nicki to run a local script — save it for after Path A is live and you want full automation.

---

## CSV Upload Implementation (Path A Detail)

### Route: `POST /api/earnings/amazon-upload`

```typescript
// lib/amazon-csv.ts — parse Amazon Associates earnings CSV
export function parseAmazonEarningsCSV(csvText: string): AmazonRow[] {
  // Skip Amazon's header rows (first ~3 rows are metadata)
  // Find the row that starts with "Date" — that's the real header
  // Parse each data row
  // Return normalized rows
}

export interface AmazonRow {
  date: string;          // "2026-02-01"
  clicks: number;
  orderedItems: number;
  shippedItems: number;
  shippedRevenue: number; // parse "$147.50" → 147.50
  shippedEarnings: number;
}
```

### Upsert to DB:
```typescript
// Upsert into platform_earnings per row
// platform = 'amazon', creator_id from session
// period_start = period_end = row.date (daily granularity)
// revenue = shippedRevenue, commission = shippedEarnings
// clicks = clicks, orders = shippedItems
```

### Upload UI:
- Simple file input on `/dashboard/earnings/upload`
- Show preview of first 5 rows before confirming
- Progress indicator while upserting
- "X rows imported, Y updated" result message

---

## Cron (Path B only)

When Path B is built, add to `vercel.json`:
```json
{
  "path": "/api/cron/amazon-sync",
  "schedule": "0 9 * * *"
}
```

---

## Start Here

**For Path A (CSV upload):**
1. Build `lib/amazon-csv.ts` parser
2. Build `POST /api/earnings/amazon-upload` route
3. Add upload button/page to dashboard
4. Test with a real exported CSV from Nicki's Associates Central

**To get a test CSV:**
Associates Central → Reports → Earnings Report → select date range → Download

---

## Reference

- Prior cookie-based sync: `git show 3ac49e5 -- sync-service/sync_amazon.py`
- Prior cookie extractor: `git show 3ac49e5 -- sync-service/extract_amazon_cookies.py`
- Schema: `amazonAssociateTag` column already exists in `creators` table
- Associate tag for Nicki: `nickientenman-20` (in Doppler `ent-agency-analytics`)
