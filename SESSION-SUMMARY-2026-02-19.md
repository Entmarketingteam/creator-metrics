# Creator Metrics — Session Summary (2026-02-19)

## What Was Done

### 1. Postgres Dual-Write Added to All 4 n8n Workflows

Every platform pipeline now writes to **Supabase Postgres** (`platform_earnings` table) in addition to its existing destination (Airtable/Google Sheets).

| Workflow | ID | Existing Output | New: Postgres Write |
|---|---|---|---|
| Amazon Associates Report Ingest | `WOdJrynlMl1zGxog` | Webhook response only | **Added** — Map to Postgres Fields → Upsert to Postgres |
| Mavely Creators – Daily auth & analytics | `3gYfgPzMu6wZ1OEZ` | Airtable | **Added** — Map to Postgres Fields → Upsert to Postgres |
| ShopMy Creator Data Pipeline | `C0hOb9317SvRUojf` | Airtable | **Added** — Map to Postgres Fields → Upsert to Postgres |
| LTK Reports to Google Sheets | `2Rr3f3YCgy3OIZWX` | Google Sheets | **Added** — Insert LTK Snapshot to Supabase |

**Postgres credential:** `Creator Metrics Postgres (Supabase)` (ID: `JGd6l3tKmUNEgfmZ`)
- Host: `aws-0-us-west-2.pooler.supabase.com:6543`
- DB: `postgres`
- User: `postgres.jidfewontxspgylmtavp`
- SSL: `disable` (n8n cloud doesn't trust Supabase's cert chain; data still encrypted via Supabase's pooler)

**Target table:** `platform_earnings` — upsert on `(creator_id, platform, period_start, period_end)`

### 2. Amazon Workflow — Fully Working ✅

Tested end-to-end via webhook with test CSV data. Execution #451 succeeded — 2 rows upserted to `platform_earnings`.

```
POST https://entagency.app.n8n.cloud/webhook/amazon-report-ingest
Body: { creator_id, period_start, period_end, csvData }
```

### 3. Mavely Workflow — Auth Bug Fixed (Untested)

**Problem:** CSRF cookie wasn't being forwarded from the GET /api/auth/csrf response to the POST login request. NextAuth requires both the csrfToken form field AND the `__Host-next-auth.csrf-token` cookie to match.

**Fixes applied:**
- `GET CSRF token` node → enabled Full Response (returns headers)
- `Merge CSRF with credentials` node → extracts `__Host-next-auth.csrf-token` cookie from Set-Cookie header
- `POST Login` node → sends extracted cookie in `Cookie` header, disabled redirect following, enabled Full Response
- `Extract session cookies` node → updated to read from fullResponse structure (`loginItem.headers` instead of `loginItem.json.headers`)

**Status:** Deployed but not yet test-run (n8n Cloud API doesn't support manual triggers). Next scheduled run: **6:00 AM CT daily**. Hit "Test Workflow" in UI to run now: https://entagency.app.n8n.cloud/workflow/3gYfgPzMu6wZ1OEZ

**Credential dependency:** Email `marketingteam@nickient.com` / password `Paisleyrae710!` in Airtable — may or may not still be valid. The CSRF fix was blocking us from even testing the creds.

### 4. ShopMy Workflow — 3 Bugs Fixed (Untested)

**Problem 1:** Auth success check was `$json.statusCode === 200` but the HTTP Request node returns `{ success: true }` as the body — no `statusCode` field. Login was succeeding but the workflow thought it failed every time.

**Problem 2:** Login node didn't have Full Response enabled, so response headers (session cookies, CSRF token) were invisible.

**Problem 3:** Nicki's `User_ID` field in Airtable is empty. All API calls to `/api/Payouts/payout_summary/{user_id}` used an empty string.

**Fixes applied:**
- `ShopMy Login` node → enabled Full Response + disabled redirect following
- `Extract Session` node → converted from Set to Code node:
  - Auth check: `$json.body.success === true || $json.statusCode === 200`
  - Extracts CSRF token from response headers
  - Extracts session cookies from Set-Cookie
  - Auto-extracts User ID from login response body as fallback
- `Get Payout Summary`, `Get Payment History`, `Get Brand Rates` nodes → all now forward session cookies via `Cookie` header

**Status:** Deployed but not yet test-run. Next scheduled run: **every 6 hours**. Hit "Test Workflow" in UI to run now: https://entagency.app.n8n.cloud/workflow/C0hOb9317SvRUojf

**Open item:** If ShopMy's login response doesn't include a user_id in the body, you'll need to manually populate `User_ID` in Airtable table `tblxPxLW0p9B1hviL` for Nicki.

### 5. LTK Workflow — Postgres Node Added, Auth Still Broken

**What was added:** `Insert LTK Snapshot to Supabase` node after the existing Google Sheets write.

**Pre-existing issue (not fixed this session):** The LTK workflow fails at its API token lookup step — Ethan said he knows how to fix this separately.

**Last error (exec #443):** `"Authorization failed - please check your credentials"` on the Postgres node — this was the OLD Postgres credential with SSL issues. The credential has since been replaced (`JGd6l3tKmUNEgfmZ`), so this specific error should be gone on next run.

---

## What's Left / Next Session

### Must Test
- [ ] **Mavely** — Click "Test Workflow" in n8n UI. If login succeeds, data flows to both Airtable and Postgres. If it still fails, the email/password in Airtable may be stale.
- [ ] **ShopMy** — Click "Test Workflow" in n8n UI. Check if login response includes a user_id. If not, populate `User_ID` in Airtable.
- [ ] **LTK** — Fix the API token issue (Ethan knows how), then test. Postgres node should work with the new credential.

### Must Verify
- [ ] **Mavely credentials** — Is `marketingteam@nickient.com` / `Paisleyrae710!` still valid on creators.mave.ly?
- [ ] **ShopMy credentials** — Is `marketingteam@nickient.com` still valid on shopmy.us? Does the login response return user data?
- [ ] **ShopMy User_ID** — Populate in Airtable (`tblxPxLW0p9B1hviL`) if not returned by login response
- [ ] **Postgres data** — After a successful run, verify rows in `platform_earnings` via Supabase dashboard or the Next.js app

### Dashboard App
- Next.js app at `/Users/ethanatchley/creator-metrics/` with Drizzle ORM
- Schema already has `platformEarnings` table defined (`lib/schema.ts`)
- Earnings query layer exists at `lib/queries/earnings.ts`
- Dashboard page at `app/dashboard/earnings/page.tsx`
- Once data is flowing to Postgres, the dashboard should show earnings automatically

### n8n Credentials Reference
| Credential | ID | Used By |
|---|---|---|
| Creator Metrics Postgres (Supabase) | `JGd6l3tKmUNEgfmZ` | All 4 workflows |
| Airtable - ShopMy Creators | `dAoeOLbTnBUK1gTy` | Mavely, ShopMy |

### Airtable Tables Reference
| Table ID | Used For |
|---|---|
| `tbllD6GuMSSEuN0Nq` | Mavely creator credentials (email, password) |
| `tblxPxLW0p9B1hviL` | ShopMy creator credentials (email, password, User_ID) |
| `tblZkX1SuNlo2DNOb` | Mavely analytics output |
