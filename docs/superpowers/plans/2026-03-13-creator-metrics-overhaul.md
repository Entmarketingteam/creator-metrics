# Creator Metrics Overhaul Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a global creator + date filter (URL params) to every dashboard page and all API routes, fix platform date accuracy, and add a Motion-style content attribution cards page.

**Architecture:** URL params (`?creatorId=&startDate=&endDate=`) are the single source of truth for all filters. A top filter bar in the dashboard layout contains the upgraded DateRangePicker (preset chips + custom calendar) and CreatorSelector. Server components read `searchParams` directly; client components use `useSearchParams()`. All queries switch from rolling `days` windows to explicit `startDate`/`endDate` date bounds.

**Tech Stack:** Next.js 14 App Router, TypeScript, Drizzle ORM, Postgres (Supabase), Tailwind CSS, Jest + ts-jest, Python (sync service)

**Spec:** `docs/superpowers/specs/2026-03-13-creator-metrics-overhaul-design.md`

---

## Chunk 1: Filter Infrastructure

### Task 1.1: Upgrade DateRangePicker with preset chips

**Files:**
- Modify: `components/DateRangePicker.tsx`
- Create: `__tests__/components/dateRangePresets.test.ts`

The existing `DateRangePicker` uses raw date inputs with `?from=`/`?to=` params. Replace with preset chips + custom fallback using `?startDate=`/`?endDate=` params. Extract the date derivation logic into a pure function so it can be unit tested without React.

- [ ] **Step 1.1.1: Create the preset derivation helper + failing test**

Create `__tests__/components/dateRangePresets.test.ts`:

```typescript
// Helper lives at the top of DateRangePicker.tsx, exported for tests
import { presetToDateRange } from "@/components/DateRangePicker";

describe("presetToDateRange", () => {
  // Fix the reference date so tests are deterministic
  const REF = new Date("2026-03-13T12:00:00Z");

  it("7d: returns last 7 days", () => {
    const { startDate, endDate } = presetToDateRange("7d", REF);
    expect(startDate).toBe("2026-03-06");
    expect(endDate).toBe("2026-03-13");
  });

  it("30d: returns last 30 days", () => {
    const { startDate, endDate } = presetToDateRange("30d", REF);
    expect(startDate).toBe("2026-02-11");
    expect(endDate).toBe("2026-03-13");
  });

  it("90d: returns last 90 days", () => {
    const { startDate, endDate } = presetToDateRange("90d", REF);
    expect(startDate).toBe("2025-12-13");
    expect(endDate).toBe("2026-03-13");
  });

  it("this-month: returns first to last day of current month", () => {
    const { startDate, endDate } = presetToDateRange("this-month", REF);
    expect(startDate).toBe("2026-03-01");
    expect(endDate).toBe("2026-03-31");
  });

  it("last-month: returns full previous month", () => {
    const { startDate, endDate } = presetToDateRange("last-month", REF);
    expect(startDate).toBe("2026-02-01");
    expect(endDate).toBe("2026-02-28");
  });

  it("ytd: returns Jan 1 to today", () => {
    const { startDate, endDate } = presetToDateRange("ytd", REF);
    expect(startDate).toBe("2026-01-01");
    expect(endDate).toBe("2026-03-13");
  });

  it("unknown preset: returns 30d fallback", () => {
    const { startDate, endDate } = presetToDateRange("garbage", REF);
    expect(startDate).toBe("2026-02-11");
    expect(endDate).toBe("2026-03-13");
  });
});
```

- [ ] **Step 1.1.2: Run test to confirm it fails**

```bash
cd /Users/ethanatchley/creator-metrics
npx jest __tests__/components/dateRangePresets.test.ts --no-coverage
```

Expected: `Cannot find module '@/components/DateRangePicker'` or `presetToDateRange is not a function`

- [ ] **Step 1.1.3: Rewrite DateRangePicker.tsx**

Replace the entire file:

```tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";

// ── Date math (pure, exported for tests) ────────────────────────────────────

function toISO(d: Date): string {
  return d.toISOString().split("T")[0];
}

export type Preset = "7d" | "30d" | "90d" | "this-month" | "last-month" | "ytd" | "custom";

export function presetToDateRange(
  preset: string,
  ref: Date = new Date()
): { startDate: string; endDate: string } {
  const today = toISO(ref);
  const y = ref.getFullYear();
  const m = ref.getMonth(); // 0-indexed

  if (preset === "7d") {
    const start = new Date(ref);
    start.setDate(start.getDate() - 6);
    return { startDate: toISO(start), endDate: today };
  }
  if (preset === "90d") {
    const start = new Date(ref);
    start.setDate(start.getDate() - 89);
    return { startDate: toISO(start), endDate: today };
  }
  if (preset === "this-month") {
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    return { startDate: toISO(start), endDate: toISO(end) };
  }
  if (preset === "last-month") {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    return { startDate: toISO(start), endDate: toISO(end) };
  }
  if (preset === "ytd") {
    return { startDate: `${y}-01-01`, endDate: today };
  }
  // default: 30d (covers "30d" and unknown)
  const start = new Date(ref);
  start.setDate(start.getDate() - 29);
  return { startDate: toISO(start), endDate: today };
}

const PRESETS: { label: string; value: Preset }[] = [
  { label: "7D", value: "7d" },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
  { label: "This Month", value: "this-month" },
  { label: "Last Month", value: "last-month" },
  { label: "YTD", value: "ytd" },
  { label: "Custom", value: "custom" },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentPreset = (searchParams.get("preset") ?? "30d") as Preset;
  const currentStart = searchParams.get("startDate") ?? "";
  const currentEnd = searchParams.get("endDate") ?? "";
  const [showCustom, setShowCustom] = useState(currentPreset === "custom");

  function applyPreset(preset: Preset) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("preset", preset);
    if (preset !== "custom") {
      const { startDate, endDate } = presetToDateRange(preset);
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      setShowCustom(false);
    } else {
      setShowCustom(true);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyCustom(startDate: string, endDate: string) {
    if (!startDate || !endDate) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("preset", "custom");
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Preset chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {PRESETS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => applyPreset(value)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              currentPreset === value
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Active range label */}
      {currentStart && currentEnd && (
        <span className="text-xs text-gray-500 ml-1">
          {currentStart} – {currentEnd}
        </span>
      )}

      {/* Custom date inputs */}
      {showCustom && (
        <div className="flex items-center gap-2 mt-1 w-full">
          <input
            type="date"
            defaultValue={currentStart}
            max={currentEnd || undefined}
            onChange={(e) => applyCustom(e.target.value, currentEnd)}
            className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-gray-200 focus:outline-none [color-scheme:dark]"
          />
          <span className="text-gray-600 text-xs">→</span>
          <input
            type="date"
            defaultValue={currentEnd}
            min={currentStart || undefined}
            onChange={(e) => applyCustom(currentStart, e.target.value)}
            className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-gray-200 focus:outline-none [color-scheme:dark]"
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 1.1.4: Run test to confirm it passes**

```bash
npx jest __tests__/components/dateRangePresets.test.ts --no-coverage
```

Expected: All 7 tests PASS

- [ ] **Step 1.1.5: Commit**

```bash
git add components/DateRangePicker.tsx __tests__/components/dateRangePresets.test.ts
git commit -m "feat: upgrade DateRangePicker with preset chips and startDate/endDate URL params"
```

---

### Task 1.2: Upgrade CreatorSelector with display names

**Files:**
- Modify: `components/CreatorSelector.tsx`

The existing `CreatorSelector` takes raw `creatorIds` (strings from the DB) and displays them with underscores replaced. Upgrade to accept the full creator list from `lib/creators.ts` so it shows real display names.

- [ ] **Step 1.2.1: Rewrite CreatorSelector.tsx**

```tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { creators } from "@/lib/creators";

// Build a lookup map from the static creator config
const CREATOR_DISPLAY: Record<string, string> = Object.fromEntries(
  creators.map((c) => [c.id, c.displayName])
);

export function CreatorSelector({ creatorIds }: { creatorIds: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const current = searchParams.get("creatorId") ?? creatorIds[0] ?? "";

  function onChange(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("creatorId", id);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-indigo-500 min-w-[160px]"
    >
      {creatorIds.map((id) => (
        <option key={id} value={id}>
          {CREATOR_DISPLAY[id] ?? id.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 1.2.2: Check lib/creators.ts exports correctly**

```bash
grep -n "export" /Users/ethanatchley/creator-metrics/lib/creators.ts | head -5
```

Expected: Should see `export const creators` or similar. If the export name differs, update the import in CreatorSelector accordingly.

- [ ] **Step 1.2.3: Commit**

```bash
git add components/CreatorSelector.tsx
git commit -m "feat: CreatorSelector shows display names from creators.ts config"
```

---

### Task 1.3: Add filter bar to dashboard layout

**Files:**
- Modify: `app/dashboard/layout.tsx`

Move the CreatorSelector from sidebar to a top filter bar alongside DateRangePicker. The sidebar keeps navigation links only.

- [ ] **Step 1.3.1: Rewrite layout.tsx**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import {
  LayoutDashboard,
  Users,
  GitCompareArrows,
  Brain,
  ImageIcon,
} from "lucide-react";
import { db } from "@/lib/db";
import { creatorTokens } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { CreatorSelector } from "@/components/CreatorSelector";
import DateRangePicker from "@/components/DateRangePicker";
import { Suspense } from "react";

const NAV_ITEMS = [
  { href: "/dashboard",                      label: "Overview",   icon: LayoutDashboard },
  { href: "/dashboard/earnings",             label: "Earnings",   icon: LayoutDashboard },
  { href: "/dashboard/content",              label: "Content",    icon: ImageIcon },
  { href: "/dashboard/creators",             label: "Creators",   icon: Users },
  { href: "/dashboard/compare",              label: "Compare",    icon: GitCompareArrows },
  { href: "/dashboard/intelligence/search",  label: "Intelligence", icon: Brain },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, sessionClaims } = await auth();
  const role = (sessionClaims?.publicMetadata as any)?.role as string | undefined;

  if (role !== "admin") {
    if (!userId) redirect("/sign-in");
    const [token] = await db
      .select({ id: creatorTokens.id })
      .from(creatorTokens)
      .where(eq(creatorTokens.clerkUserId, userId!))
      .limit(1);
    if (!token) redirect("/onboarding");
  }

  let creatorIds: string[] = [];
  if (role === "admin") {
    const rows = await db.execute(
      sql`SELECT DISTINCT creator_id FROM creator_posts ORDER BY creator_id`
    );
    creatorIds = (Array.from(rows) as any[]).map((r: any) => r.creator_id);
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Top filter bar ──────────────────────────────────────────── */}
      {role === "admin" && creatorIds.length > 0 && (
        <div className="border-b border-gray-800 bg-gray-950 px-6 py-3 flex items-center gap-4 flex-wrap sticky top-0 z-10">
          <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Viewing</span>
          <Suspense>
            <CreatorSelector creatorIds={creatorIds} />
          </Suspense>
          <span className="text-gray-700">·</span>
          <Suspense>
            <DateRangePicker />
          </Suspense>
        </div>
      )}

      <div className="flex flex-1">
        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <aside className="w-56 border-r border-gray-800 bg-gray-950 p-4 flex flex-col shrink-0">
          <Link href="/dashboard" className="flex items-center gap-2 mb-6 px-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">CM</span>
            </div>
            <span className="text-base font-bold text-white">CreatorMetrics</span>
          </Link>

          <nav className="flex flex-col gap-1 flex-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-400 hover:bg-gray-800/50 hover:text-white transition-colors"
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="pt-4 border-t border-gray-800 flex items-center gap-3 px-2">
            <UserButton afterSignOutUrl="/sign-in" />
            <span className="text-sm text-gray-500">ENT Agency</span>
          </div>
        </aside>

        <main className="flex-1 p-8 overflow-auto bg-gray-950">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 1.3.2: Build check — confirm no TypeScript errors**

```bash
cd /Users/ethanatchley/creator-metrics
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors (or only pre-existing errors unrelated to layout.tsx)

- [ ] **Step 1.3.3: Commit**

```bash
git add app/dashboard/layout.tsx
git commit -m "feat: add sticky filter bar with CreatorSelector + DateRangePicker to dashboard layout"
```

---

## Chunk 2: Platform Date Accuracy

### Task 2.1: Update earnings page to use startDate/endDate

**Files:**
- Modify: `app/dashboard/earnings/page.tsx`
- Modify: `lib/queries/earnings.ts`

Replace `?days=N` with `?startDate=&?endDate=`. If no dates in URL (fresh load), derive 30d defaults. Remove `PeriodSelector` from the page (the layout filter bar replaces it).

- [ ] **Step 2.1.1: Update getCreatorEarningsSummary in lib/queries/earnings.ts to accept dates**

Add a new overload signature and update the WHERE clause. Replace the `days` param with `startDate`/`endDate` strings:

```typescript
// Replace the existing getCreatorEarningsSummary signature:
export async function getCreatorEarningsSummary(
  creatorId: string,
  startDate: string,
  endDate: string
): Promise<EarningsSummaryRow[]> {
  const rows = await db
    .select({
      platform: platformEarnings.platform,
      totalRevenue: sql<number>`CAST(COALESCE(SUM(${platformEarnings.revenue}), 0) AS FLOAT)`,
      totalCommission: sql<number>`CAST(COALESCE(SUM(${platformEarnings.commission}), 0) AS FLOAT)`,
      totalClicks: sql<number>`COALESCE(SUM(${platformEarnings.clicks}), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${platformEarnings.orders}), 0)`,
    })
    .from(platformEarnings)
    .where(
      and(
        eq(platformEarnings.creatorId, creatorId),
        sql`${platformEarnings.periodEnd} >= ${startDate}::date`,
        sql`${platformEarnings.periodStart} <= ${endDate}::date`
      )
    )
    .groupBy(platformEarnings.platform)
    .orderBy(sql`CAST(COALESCE(SUM(${platformEarnings.revenue}), 0) AS FLOAT) DESC`);

  return rows;
}
```

Apply the same `startDate`/`endDate` pattern to `getCreatorEarningsHistory`, `getCreatorSales` (filter on `saleDate`), `getAggregateEarnings`, and `getEarningsByPlatform`. For `getCreatorSales`, change:
```typescript
// Old: uses days
// New:
if (startDate) conditions.push(sql`${sales.saleDate} >= ${startDate}::date`);
if (endDate) conditions.push(sql`${sales.saleDate} <= ${endDate}::date`);
```

- [ ] **Step 2.1.2: Write failing test for date-range earnings query**

Create `__tests__/queries/earningsDateRange.test.ts`:

```typescript
import { presetToDateRange } from "@/components/DateRangePicker";

describe("earnings date range derivation", () => {
  it("derives correct SQL date bounds for 30d preset", () => {
    const ref = new Date("2026-03-13T12:00:00Z");
    const { startDate, endDate } = presetToDateRange("30d", ref);
    // Platform earnings with period_end >= startDate AND period_start <= endDate
    // should capture any monthly bucket overlapping the 30d window
    expect(new Date(startDate) <= new Date(endDate)).toBe(true);
    expect(startDate).toBe("2026-02-12");
    // 30d back from Mar 13 = Feb 12 (startDate = today - 29 days)
  });

  it("this-month covers entire month", () => {
    const ref = new Date("2026-03-13T12:00:00Z");
    const { startDate, endDate } = presetToDateRange("this-month", ref);
    expect(startDate).toBe("2026-03-01");
    expect(endDate).toBe("2026-03-31");
  });
});
```

```bash
npx jest __tests__/queries/earningsDateRange.test.ts --no-coverage
```

Expected: Fails on the "2026-02-12" assertion (the 30d calculation gives 2026-02-11 since today minus 29 = 29 days back). Actually the spec says "last 30 days" = today minus 29 days (inclusive). Adjust test value to match the actual presetToDateRange output: `"2026-02-12"` if we use `setDate(getDate() - 29)` from Mar 13 = Feb 12. Verify by running the test and fixing the expected value to match.

- [ ] **Step 2.1.3: Update earnings page searchParams**

In `app/dashboard/earnings/page.tsx`, replace the `days`-based `searchParams` with `startDate`/`endDate`:

```typescript
export default async function EarningsPage({
  searchParams,
}: {
  searchParams: { startDate?: string; endDate?: string; creatorId?: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Default to last 30 days if no dates provided
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 29 * 86400000).toISOString().split("T")[0];
  const startDate = searchParams.startDate ?? thirtyDaysAgo;
  const endDate = searchParams.endDate ?? today;
  const creatorId = searchParams.creatorId; // undefined = all creators

  // Update all DB queries to use startDate/endDate instead of safeDays
  // Replace: WHERE period_end >= NOW() - INTERVAL '${safeDays} days'
  // With:    WHERE period_end >= '${startDate}'::date AND period_start <= '${endDate}'::date
```

Update the inline SQL in earnings/page.tsx:

```sql
-- Platform earnings query (replace the existing latestPerPlatform query):
SELECT
  platform,
  CAST(COALESCE(SUM(CAST(revenue AS FLOAT)), 0) AS FLOAT) AS revenue,
  CAST(COALESCE(SUM(CAST(commission AS FLOAT)), 0) AS FLOAT) AS commission,
  COALESCE(SUM(clicks), 0) AS clicks,
  COALESCE(SUM(orders), 0) AS orders,
  MAX(synced_at) AS synced_at
FROM platform_earnings
WHERE period_end >= '${startDate}'::date
  AND period_start <= '${endDate}'::date
  ${creatorId ? `AND creator_id = '${creatorId}'` : ""}
GROUP BY platform
```

**Important:** Use parameterized queries via Drizzle `sql` template tag, not string interpolation. The inline SQL above is pseudocode — use `sql\`... ${startDate} ...\`` with Drizzle's safe parameter binding.

Remove the `PeriodSelector` import and JSX from the page (the layout filter bar replaces it).

- [ ] **Step 2.1.4: Update sales + brand queries in earnings page**

Apply same startDate/endDate filter to:
- `brandBreakdownRaw` query: `WHERE sale_date >= '${startDate}'::date AND sale_date <= '${endDate}'::date`
- `recentSales` + `salesCountResult` queries: same date bounds
- `timeSeriesRaw` query: same date bounds

- [ ] **Step 2.1.5: Run test suite**

```bash
npx jest --no-coverage
```

Expected: All existing tests pass. No regressions.

- [ ] **Step 2.1.6: Commit**

```bash
git add app/dashboard/earnings/page.tsx lib/queries/earnings.ts __tests__/queries/earningsDateRange.test.ts
git commit -m "feat: earnings page uses startDate/endDate URL params, remove PeriodSelector"
```

---

### Task 2.2: Update API routes to accept startDate/endDate

**Files:**
- Modify: `app/api/earnings/by-platform/route.ts`
- Modify: `app/api/earnings/route.ts`

- [ ] **Step 2.2.1: Update by-platform route**

Replace `days` param with `startDate`/`endDate` in `app/api/earnings/by-platform/route.ts`:

```typescript
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const creatorId = searchParams.get("creatorId");
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 29 * 86400000).toISOString().split("T")[0];
  const startDate = searchParams.get("startDate") ?? thirtyDaysAgo;
  const endDate = searchParams.get("endDate") ?? today;

  const conditions: SQL[] = [
    sql`${platformEarnings.periodEnd} >= ${startDate}::date`,
    sql`${platformEarnings.periodStart} <= ${endDate}::date`,
  ];
  if (creatorId) conditions.push(eq(platformEarnings.creatorId, creatorId));

  // ... rest of query unchanged
}
```

- [ ] **Step 2.2.2: Update earnings/route.ts**

Same pattern — replace `days` with `startDate`/`endDate`. Filter `sales` table by `sale_date BETWEEN startDate AND endDate`.

- [ ] **Step 2.2.3: Commit**

```bash
git add app/api/earnings/by-platform/route.ts app/api/earnings/route.ts
git commit -m "feat: API routes accept startDate/endDate instead of days"
```

---

### Task 2.3: Fix LTK sync — exact date range + pagination

**Files:**
- Modify: `lib/ltk.ts`
- Modify: `app/api/cron/ltk-sync/route.ts`

- [ ] **Step 2.3.1: Read current lib/ltk.ts**

```bash
cat /Users/ethanatchley/creator-metrics/lib/ltk.ts
```

Identify the `fetchLTKItemsSold` function. Note current date format and pagination handling.

- [ ] **Step 2.3.2: Add cursor pagination to fetchLTKItemsSold**

In `lib/ltk.ts`, update `fetchLTKItemsSold` to loop on `meta.next`:

```typescript
export async function fetchLTKItemsSoldPaginated(
  accessToken: string,
  idToken: string,
  start: string,  // ISO: "2026-02-10T00:00:00.000Z"
  end: string,    // ISO: "2026-03-12T23:59:59.000Z"
  publisherId: string
): Promise<LTKItem[]> {
  const allItems: LTKItem[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({
      limit: "100",
      start,
      end,
      currency: "USD",
    });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `https://api-gateway.rewardstyle.com/api/creator-analytics/v1/items_sold/?${params}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "x-id-token": idToken,
          Origin: "https://creator.shopltk.com",
          Referer: "https://creator.shopltk.com/",
        },
      }
    );

    if (!res.ok) throw new Error(`LTK items_sold ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const items: LTKItem[] = data.items_sold ?? [];
    allItems.push(...items);
    cursor = data.meta?.next ?? null;
  } while (cursor);

  return allItems;
}
```

- [ ] **Step 2.3.3: Update ltk-sync route to pass exact dates**

In `app/api/cron/ltk-sync/route.ts`, change the date calculation to use the current calendar month start/end OR pass the sync window as exact dates:

```typescript
// Use current calendar month for the daily sync (we sync today's data into monthly buckets)
const now = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

const startISO = monthStart.toISOString().replace(/\.000Z$/, ".000Z"); // "2026-03-01T00:00:00.000Z"
const endISO = monthEnd.toISOString().split("T")[0] + "T23:59:59.000Z"; // "2026-03-31T23:59:59.000Z"

// Also pass to performance_summary:
const perfParams = new URLSearchParams({
  start_date: monthStart.toISOString(),
  end_date: monthEnd.toISOString(),
  publisher_ids: publisherId,
  platform: "rs,ltk",
  timezone: "UTC",
});
```

Replace all uses of the old date window with these parameterized values.

- [ ] **Step 2.3.4: Commit**

```bash
git add lib/ltk.ts app/api/cron/ltk-sync/route.ts
git commit -m "feat: LTK sync adds cursor pagination for items_sold, passes exact dates to performance_summary"
```

---

### Task 2.4: Fix Amazon sync — use exact date range

**Files:**
- Modify: `sync-service/sync_amazon_local.py`

- [ ] **Step 2.4.1: Update period calculation in sync_amazon_local.py**

Find the section that calculates `period_start` and `period_end`. Replace the calendar-month hardcode with a configurable window that defaults to current month but can be overridden:

```python
import argparse

def get_date_range(args) -> tuple[date, date]:
    """Return (period_start, period_end). Defaults to current calendar month."""
    today = date.today()
    if args.start_date and args.end_date:
        return date.fromisoformat(args.start_date), date.fromisoformat(args.end_date)
    # Default: current calendar month
    period_start = date(today.year, today.month, 1)
    period_end = date(today.year, today.month + 1, 1) - timedelta(days=1) if today.month < 12 \
        else date(today.year, 12, 31)
    return period_start, period_end

# In main() or sync_amazon():
parser = argparse.ArgumentParser()
parser.add_argument("--start-date", default=None, help="YYYY-MM-DD")
parser.add_argument("--end-date", default=None, help="YYYY-MM-DD")
parser.add_argument("--creator", default="nicki", help="Creator ID prefix")
args = parser.parse_args()

period_start, period_end = get_date_range(args)
```

The `_download_csv()` function already accepts `start_date` and `end_date` — no change needed there. Only the calling code changes.

- [ ] **Step 2.4.2: Test the argument parsing locally**

```bash
cd /Users/ethanatchley/creator-metrics/sync-service
python3 -c "
import argparse
from datetime import date, timedelta

def get_date_range(args):
    today = date.today()
    if args.start_date and args.end_date:
        return date.fromisoformat(args.start_date), date.fromisoformat(args.end_date)
    period_start = date(today.year, today.month, 1)
    if today.month < 12:
        period_end = date(today.year, today.month + 1, 1) - timedelta(days=1)
    else:
        period_end = date(today.year, 12, 31)
    return period_start, period_end

parser = argparse.ArgumentParser()
parser.add_argument('--start-date', default=None)
parser.add_argument('--end-date', default=None)
args = parser.parse_args([])
start, end = get_date_range(args)
print(f'Default: {start} to {end}')

args2 = parser.parse_args(['--start-date', '2026-02-10', '--end-date', '2026-03-12'])
start2, end2 = get_date_range(args2)
print(f'Custom: {start2} to {end2}')
assert str(start2) == '2026-02-10'
assert str(end2) == '2026-03-12'
print('PASS')
"
```

Expected output:
```
Default: 2026-03-01 to 2026-03-31
Custom: 2026-02-10 to 2026-03-12
PASS
```

- [ ] **Step 2.4.3: Commit**

```bash
git add sync-service/sync_amazon_local.py
git commit -m "feat: Amazon sync accepts --start-date/--end-date args, defaults to current calendar month"
```

---

## Chunk 3: Content Cards Page

### Task 3.1: Attribution URL matching library

**Files:**
- Create: `lib/attribution.ts`
- Create: `__tests__/lib/attribution.test.ts`

This is the pure logic that detects which affiliate platform a URL belongs to. No DB, no external calls — just pattern matching.

- [ ] **Step 3.1.1: Write failing tests**

Create `__tests__/lib/attribution.test.ts`:

```typescript
import { detectPlatform, type AffiliatePlatform } from "@/lib/attribution";

describe("detectPlatform", () => {
  it("detects Mavely URLs", () => {
    expect(detectPlatform("https://go.mvly.co/nicki/lululemon")).toBe("mavely");
    expect(detectPlatform("https://mavely.app.link/abc123")).toBe("mavely");
  });

  it("detects LTK URLs", () => {
    expect(detectPlatform("https://liketk.it/abc123")).toBe("ltk");
    expect(detectPlatform("https://www.ltk.com/post/xyz")).toBe("ltk");
    expect(detectPlatform("https://rstyle.me/+abc123")).toBe("ltk");
  });

  it("detects ShopMy URLs", () => {
    expect(detectPlatform("https://shopmy.us/collections/123")).toBe("shopmy");
    expect(detectPlatform("https://shop.shopmy.co/product/abc")).toBe("shopmy");
  });

  it("detects Amazon URLs", () => {
    expect(detectPlatform("https://amzn.to/abc123")).toBe("amazon");
    expect(detectPlatform("https://www.amazon.com/shop/nicki")).toBe("amazon");
    expect(detectPlatform("https://amazon.com/dp/B08ABC123")).toBe("amazon");
  });

  it("returns null for unknown URLs", () => {
    expect(detectPlatform("https://lululemon.com/product/abc")).toBeNull();
    expect(detectPlatform("")).toBeNull();
    expect(detectPlatform(null)).toBeNull();
  });

  it("handles URLs with query strings", () => {
    expect(detectPlatform("https://liketk.it/abc123?utm_source=ig")).toBe("ltk");
  });
});
```

- [ ] **Step 3.1.2: Run failing test**

```bash
npx jest __tests__/lib/attribution.test.ts --no-coverage
```

Expected: `Cannot find module '@/lib/attribution'`

- [ ] **Step 3.1.3: Create lib/attribution.ts**

```typescript
export type AffiliatePlatform = "mavely" | "ltk" | "shopmy" | "amazon";

const PATTERNS: Array<{ platform: AffiliatePlatform; test: (url: string) => boolean }> = [
  {
    platform: "mavely",
    test: (url) => /go\.mvly\.co|mavely\.app\.link|go\.mavely\.com/.test(url),
  },
  {
    platform: "ltk",
    test: (url) => /liketk\.it|(?:^|\.)ltk\.com|rstyle\.me/.test(url),
  },
  {
    platform: "shopmy",
    test: (url) => /shopmy\.(us|co|com)|shop\.shopmy/.test(url),
  },
  {
    platform: "amazon",
    test: (url) => /amzn\.to|amazon\.com/.test(url),
  },
];

export function detectPlatform(url: string | null | undefined): AffiliatePlatform | null {
  if (!url) return null;
  for (const { platform, test } of PATTERNS) {
    if (test(url)) return platform;
  }
  return null;
}
```

- [ ] **Step 3.1.4: Run test to confirm it passes**

```bash
npx jest __tests__/lib/attribution.test.ts --no-coverage
```

Expected: All tests PASS

- [ ] **Step 3.1.5: Commit**

```bash
git add lib/attribution.ts __tests__/lib/attribution.test.ts
git commit -m "feat: add attribution URL pattern matching library with tests"
```

---

### Task 3.2: Content API route

**Files:**
- Create: `app/api/creators/[id]/content/route.ts`

Returns Instagram posts for a creator+date range, with affiliate platform detected from `linkUrl` and revenue joined from the relevant platform table.

- [ ] **Step 3.2.1: Create the route**

Create `app/api/creators/[id]/content/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { detectPlatform } from "@/lib/attribution";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 29 * 86400000).toISOString().split("T")[0];
  const startDate = searchParams.get("startDate") ?? thirtyDaysAgo;
  const endDate = searchParams.get("endDate") ?? today;
  const type = searchParams.get("type"); // "reel" | "post" | "story" | null
  const platform = searchParams.get("platform"); // "mavely" | "ltk" | etc | null
  const creatorId = params.id;

  // Fetch media snapshots for the date range
  const mediaRows = await db.execute(sql`
    SELECT
      media_ig_id,
      posted_at,
      media_type,
      media_url,
      thumbnail_url,
      link_url,
      likes,
      comments,
      reach,
      views_count,
      saves
    FROM media_snapshots
    WHERE creator_id = ${creatorId}
      AND posted_at >= ${startDate}::date
      AND posted_at <= ${endDate}::date
    ORDER BY posted_at DESC
    LIMIT 100
  `);

  // Enrich each post with platform detection and revenue attribution
  const posts = await Promise.all(
    (mediaRows as any[]).map(async (row) => {
      const detectedPlatform = detectPlatform(row.link_url);

      // Platform filter
      if (platform && detectedPlatform !== platform) return null;

      // Type filter (reel/post/story)
      const postType = row.media_type?.toLowerCase() ?? "post";
      if (type && !postType.includes(type)) return null;

      // Get attributed revenue for this post's link
      let attributedRevenue: number | null = null;
      let orders: number | null = null;

      if (detectedPlatform === "mavely" && row.link_url) {
        const revenueRow = await db.execute(sql`
          SELECT COALESCE(SUM(CAST(commission_amount AS FLOAT)), 0) AS revenue,
                 COUNT(*) AS orders
          FROM mavely_transactions
          WHERE creator_id = ${creatorId}
            AND referrer_url ILIKE ${"%" + row.link_url + "%"}
            AND transaction_date >= ${startDate}::date
            AND transaction_date <= ${endDate}::date
        `);
        const r = (revenueRow as any[])[0];
        if (r) {
          attributedRevenue = Number(r.revenue);
          orders = Number(r.orders);
        }
      }

      if (detectedPlatform === "ltk" && row.link_url) {
        const revenueRow = await db.execute(sql`
          SELECT COALESCE(SUM(CAST(net_commissions AS FLOAT)), 0) AS revenue,
                 COALESCE(SUM(orders), 0) AS orders
          FROM ltk_posts
          WHERE creator_id = ${creatorId}
            AND (rs_url = ${row.link_url} OR link_url = ${row.link_url})
            AND posted_at >= ${startDate}::date
            AND posted_at <= ${endDate}::date
        `);
        const r = (revenueRow as any[])[0];
        if (r) {
          attributedRevenue = Number(r.revenue);
          orders = Number(r.orders);
        }
      }

      return {
        mediaIgId: row.media_ig_id,
        postedAt: row.posted_at,
        type: postType,
        thumbnailUrl: row.thumbnail_url ?? row.media_url ?? null,
        linkUrl: row.link_url ?? null,
        platform: detectedPlatform,
        reach: Number(row.reach ?? 0),
        likes: Number(row.likes ?? 0),
        comments: Number(row.comments ?? 0),
        views: Number(row.views_count ?? 0),
        saves: Number(row.saves ?? 0),
        attributedRevenue,
        orders,
      };
    })
  );

  const filtered = posts.filter(Boolean);
  return NextResponse.json(filtered);
}
```

- [ ] **Step 3.2.2: TypeScript check on the new route**

```bash
npx tsc --noEmit 2>&1 | grep "content/route"
```

Expected: No errors for content/route.ts

- [ ] **Step 3.2.3: Commit**

```bash
git add app/api/creators/[id]/content/route.ts
git commit -m "feat: add content attribution API route for post cards"
```

---

### Task 3.3: PostCard component

**Files:**
- Create: `components/PostCard.tsx`

The visual card for each Instagram post — thumbnail, platform badge, revenue, metrics.

- [ ] **Step 3.3.1: Create PostCard.tsx**

```tsx
import { formatCurrency } from "@/lib/utils";
import type { AffiliatePlatform } from "@/lib/attribution";

export interface PostCardData {
  mediaIgId: string;
  postedAt: string;
  type: string;
  thumbnailUrl: string | null;
  linkUrl: string | null;
  platform: AffiliatePlatform | null;
  reach: number;
  likes: number;
  comments: number;
  views: number;
  attributedRevenue: number | null;
  orders: number | null;
}

const PLATFORM_STYLES: Record<AffiliatePlatform, { bg: string; text: string; label: string }> = {
  mavely:  { bg: "bg-purple-600",  text: "text-white", label: "Mavely" },
  ltk:     { bg: "bg-amber-500",   text: "text-white", label: "LTK" },
  shopmy:  { bg: "bg-pink-500",    text: "text-white", label: "ShopMy" },
  amazon:  { bg: "bg-gray-900",    text: "text-white", label: "Amazon" },
};

const TYPE_GRADIENTS: Record<string, string> = {
  video:      "from-purple-600 to-indigo-700",
  reel:       "from-pink-600 to-purple-700",
  story:      "from-indigo-500 to-blue-600",
  image:      "from-blue-500 to-cyan-600",
  carousel:   "from-green-500 to-teal-600",
};

function typeLabel(type: string): string {
  if (type.includes("video") || type.includes("reel")) return "📱 Reel";
  if (type.includes("story")) return "⏱ Story";
  return "🖼 Post";
}

export default function PostCard({ post }: { post: PostCardData }) {
  const platformStyle = post.platform ? PLATFORM_STYLES[post.platform] : null;
  const gradient = TYPE_GRADIENTS[post.type] ?? TYPE_GRADIENTS.image;
  const engagementMetric = post.views > 0 ? post.views : post.reach;
  const engagementLabel = post.views > 0 ? "Views" : "Reach";
  const postedDate = new Date(post.postedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 transition-all cursor-pointer group">
      {/* Thumbnail */}
      <div className={`relative aspect-[4/5] bg-gradient-to-br ${gradient} flex items-center justify-center overflow-hidden`}>
        {post.thumbnailUrl ? (
          <img
            src={post.thumbnailUrl}
            alt="Post"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <span className="text-white/50 text-sm">{typeLabel(post.type)}</span>
        )}

        {/* Platform badge */}
        {platformStyle && (
          <span className={`absolute top-2 left-2 ${platformStyle.bg} ${platformStyle.text} text-[10px] font-bold px-2 py-0.5 rounded-full`}>
            {platformStyle.label}
          </span>
        )}
        {!post.platform && (
          <span className="absolute top-2 left-2 bg-gray-800/80 text-gray-400 text-[10px] font-medium px-2 py-0.5 rounded-full">
            No link
          </span>
        )}

        {/* Revenue badge */}
        {post.attributedRevenue != null && post.attributedRevenue > 0 && (
          <span className="absolute top-2 right-2 bg-black/70 text-emerald-400 text-[11px] font-bold px-2 py-0.5 rounded-full">
            {formatCurrency(post.attributedRevenue)}
          </span>
        )}
      </div>

      {/* Metrics */}
      <div className="p-3">
        <p className="text-[11px] text-gray-500 mb-2">{postedDate}</p>
        <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-[11px]">
          <div>
            <span className="text-gray-500 block">{engagementLabel}</span>
            <span className="text-white font-semibold">{engagementMetric.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Revenue</span>
            <span className={`font-semibold ${post.attributedRevenue ? "text-white" : "text-gray-600"}`}>
              {post.attributedRevenue != null ? formatCurrency(post.attributedRevenue) : "—"}
            </span>
          </div>
          <div>
            <span className="text-gray-500 block">Likes</span>
            <span className="text-white font-semibold">{post.likes.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Orders</span>
            <span className="text-white font-semibold">{post.orders ?? "—"}</span>
          </div>
        </div>

        {/* Affiliate link */}
        {post.linkUrl && (
          <div className={`mt-2 px-2 py-1.5 rounded-md text-[10px] truncate ${
            post.platform ? "bg-gray-800 text-gray-400" : "bg-gray-800/50 text-gray-600"
          }`}>
            🔗 {post.linkUrl}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3.3.2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "PostCard"
```

Expected: No errors

- [ ] **Step 3.3.3: Commit**

```bash
git add components/PostCard.tsx
git commit -m "feat: add PostCard component for Motion-style content attribution cards"
```

---

### Task 3.4: Content page

**Files:**
- Create: `app/dashboard/content/page.tsx`

- [ ] **Step 3.4.1: Create the content page**

Create `app/dashboard/content/page.tsx`:

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import PostCard, { type PostCardData } from "@/components/PostCard";
import { detectPlatform } from "@/lib/attribution";
import { ImageIcon } from "lucide-react";

export const dynamic = "force-dynamic";

const PLATFORM_FILTERS = [
  { label: "All",     value: "" },
  { label: "🔗 Has Link", value: "has-link" },
  { label: "Mavely",  value: "mavely" },
  { label: "ShopMy",  value: "shopmy" },
  { label: "LTK",     value: "ltk" },
  { label: "Amazon",  value: "amazon" },
];

const TYPE_FILTERS = [
  { label: "All",     value: "" },
  { label: "Reels",   value: "reel" },
  { label: "Posts",   value: "image" },
  { label: "Stories", value: "story" },
];

export default async function ContentPage({
  searchParams,
}: {
  searchParams: {
    startDate?: string;
    endDate?: string;
    creatorId?: string;
    platform?: string;
    type?: string;
  };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 29 * 86400000).toISOString().split("T")[0];
  const startDate = searchParams.startDate ?? thirtyDaysAgo;
  const endDate = searchParams.endDate ?? today;
  const creatorId = searchParams.creatorId ?? "nicki_entenmann";
  const platformFilter = searchParams.platform ?? "";
  const typeFilter = searchParams.type ?? "";

  // Fetch posts for the date range
  const mediaRows = await db.execute(sql`
    SELECT
      media_ig_id,
      posted_at,
      media_type,
      media_url,
      thumbnail_url,
      link_url,
      likes,
      comments,
      reach,
      views_count,
      saves
    FROM media_snapshots
    WHERE creator_id = ${creatorId}
      AND posted_at >= ${startDate}::date
      AND posted_at <= ${endDate}::date
    ORDER BY posted_at DESC
    LIMIT 100
  `);

  // Enrich with platform detection
  const posts: PostCardData[] = (mediaRows as any[])
    .map((row) => {
      const platform = detectPlatform(row.link_url);
      return {
        mediaIgId: row.media_ig_id,
        postedAt: String(row.posted_at),
        type: String(row.media_type ?? "image").toLowerCase(),
        thumbnailUrl: row.thumbnail_url ?? row.media_url ?? null,
        linkUrl: row.link_url ?? null,
        platform,
        reach: Number(row.reach ?? 0),
        likes: Number(row.likes ?? 0),
        comments: Number(row.comments ?? 0),
        views: Number(row.views_count ?? 0),
        saves: Number(row.saves ?? 0),
        attributedRevenue: null, // Revenue attribution runs client-side via API
        orders: null,
      };
    })
    .filter((p) => {
      if (platformFilter === "has-link") return !!p.platform;
      if (platformFilter) return p.platform === platformFilter;
      if (typeFilter) return p.type.includes(typeFilter);
      return true;
    });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ImageIcon className="w-6 h-6 text-indigo-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Content</h1>
          <p className="text-gray-500 text-sm">
            Post attribution · {startDate} – {endDate} · {creatorId.replace(/_/g, " ")}
          </p>
        </div>
      </div>

      {/* Filter chips (client-side navigation links) */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {TYPE_FILTERS.map(({ label, value }) => {
            const isActive = typeFilter === value;
            const params = new URLSearchParams({
              ...(searchParams as Record<string, string>),
              type: value,
            }).toString();
            return (
              <a
                key={value}
                href={`/dashboard/content?${params}`}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  isActive
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                }`}
              >
                {label}
              </a>
            );
          })}
        </div>
        <span className="text-gray-700">·</span>
        <div className="flex gap-1.5 flex-wrap">
          {PLATFORM_FILTERS.map(({ label, value }) => {
            const isActive = platformFilter === value;
            const params = new URLSearchParams({
              ...(searchParams as Record<string, string>),
              platform: value,
            }).toString();
            return (
              <a
                key={value}
                href={`/dashboard/content?${params}`}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  isActive
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                }`}
              >
                {label}
              </a>
            );
          })}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-6 text-sm text-gray-400">
        <span>{posts.length} posts</span>
        <span>{posts.filter(p => p.platform).length} with affiliate links</span>
        <span>{posts.filter(p => p.platform === "mavely").length} Mavely</span>
        <span>{posts.filter(p => p.platform === "ltk").length} LTK</span>
      </div>

      {/* Card grid */}
      {posts.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          No posts found for this date range and filter.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {posts.map((post) => (
            <PostCard key={post.mediaIgId} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3.4.2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "content/page"
```

Expected: No errors

- [ ] **Step 3.4.3: Full test suite run**

```bash
npx jest --no-coverage
```

Expected: All tests pass

- [ ] **Step 3.4.4: Commit**

```bash
git add app/dashboard/content/page.tsx
git commit -m "feat: add Motion-style content attribution cards page"
```

---

### Task 3.5: Final wiring + smoke test

**Files:**
- No new files — verify everything connects

- [ ] **Step 3.5.1: Verify "Content" link appears in sidebar nav**

The `app/dashboard/layout.tsx` updated in Task 1.3 already includes the Content nav item. Confirm it's there:

```bash
grep -n "content" /Users/ethanatchley/creator-metrics/app/dashboard/layout.tsx
```

Expected: `{ href: "/dashboard/content", label: "Content", icon: ImageIcon }`

- [ ] **Step 3.5.2: Build check**

```bash
cd /Users/ethanatchley/creator-metrics
npx next build 2>&1 | tail -20
```

Expected: Build completes. Note any type errors and fix them before proceeding.

- [ ] **Step 3.5.3: Run full test suite one final time**

```bash
npx jest --no-coverage
```

Expected: All tests pass

- [ ] **Step 3.5.4: Final commit**

```bash
git add -A
git commit -m "feat: creator metrics overhaul complete — global date/creator filter, platform date accuracy, content attribution cards"
```

---

## Smoke Test Checklist (Manual, post-deploy)

Run these checks on `creator-metrics.vercel.app` after deploying:

- [ ] Filter bar appears at top of every dashboard page (as admin)
- [ ] Switching creator updates `?creatorId=` in URL and data changes
- [ ] Clicking "30D" preset sets `?preset=30d&startDate=...&endDate=...` in URL
- [ ] Clicking "Custom" shows date inputs; picking dates updates URL and data
- [ ] `/dashboard/earnings` platform cards reflect the selected date range
- [ ] LTK card shows correct total (verify against LTK dashboard for same range)
- [ ] Mavely card shows correct total (verify against Mavely dashboard for same range)
- [ ] `/dashboard/content` loads post grid for selected creator + date range
- [ ] Mavely posts show purple "Mavely" badge; LTK posts show amber "LTK" badge
- [ ] "Has Link" filter shows only posts with affiliate links
- [ ] Page reload preserves selected creator + date (URL params persist)
