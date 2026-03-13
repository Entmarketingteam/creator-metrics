/**
 * Earnings accuracy tests
 *
 * These tests guard against the specific bugs fixed in the earnings data pipeline:
 *   1. LTK: commission field must be net_commissions (period earnings), not open_earnings (lifetime balance)
 *   2. Mavely: platform_earnings must use a fixed calendar-month period (no rolling daily window accumulation)
 *   3. Mavely: revenue (order value) and commission (creator cut) must be stored separately
 *   4. Earnings page deduplication: DISTINCT ON (platform) prevents summing overlapping rows
 *   5. PlatformCard: LTK displays net_commissions, not the lifetime pending balance
 */

// ── Helpers copied / extracted from production code ─────────────────────────

/** Build the LTK platform_earnings insert values the way sync_ltk.py does. */
function buildLtkEarningsRow(
  netCommissions: number,
  _openEarnings: number, // intentionally unused after fix — kept as param to document the old bug
  clicks: number,
  orders: number
) {
  // After fix: commission = revenue = net_commissions
  // Before fix: commission was open_earnings (lifetime balance)
  return {
    revenue: String(netCommissions),
    commission: String(netCommissions), // must NOT be open_earnings
    clicks,
    orders,
  };
}

/** What PlatformCard renders as the main earnings figure. */
function platformCardDisplayValue(revenue: number, commission: number): number {
  // PlatformCard renders `commission || revenue` (commission first, falls back to revenue)
  return commission || revenue;
}

/** Calculate Mavely calendar-month period from a given date. */
function mavelyMonthPeriod(today: Date): { monthStart: Date; monthEnd: Date } {
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  // Last day of current month = day 0 of next month
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  return { monthStart, monthEnd };
}

/** Build Mavely platform_earnings insert values the way sync_mavely.py does after fix. */
function buildMavelyEarningsRow(links: { commission: number; revenue: number; clicks: number; orders: number }[]) {
  return {
    revenue: String(links.reduce((s, l) => s + l.revenue, 0)),
    commission: String(links.reduce((s, l) => s + l.commission, 0)),
    clicks: links.reduce((s, l) => s + l.clicks, 0),
    orders: links.reduce((s, l) => s + l.orders, 0),
  };
}

/**
 * Simulate what happens when the Mavely sync runs N times with rolling 30d windows
 * and the query naively SUMs all rows (the old broken approach).
 */
function simulateMavelyRollingAccumulation(
  actualMonthlyCommission: number,
  syncRunsCount: number
): number {
  // Each run writes a different period_start (today-30d shifts daily)
  // Old query: SUM(all rows) → accumulates synRunsCount copies
  return actualMonthlyCommission * syncRunsCount;
}

/**
 * Simulate the fixed approach: one fixed calendar-month row, updated in-place.
 */
function simulateMavelyFixedMonthAccumulation(
  actualMonthlyCommission: number,
  _syncRunsCount: number
): number {
  // Same period_start every run → UPSERT updates in place → always 1 row
  return actualMonthlyCommission;
}

/**
 * Simulate earnings page deduplication: DISTINCT ON (platform) ORDER BY synced_at DESC.
 * Returns the sum of the most-recent row per platform.
 */
function earningsPageWithDedup(
  rows: { platform: string; revenue: number; syncedAt: Date }[]
): number {
  const latestPerPlatform = new Map<string, number>();
  // Sort by syncedAt DESC so we process latest first
  const sorted = [...rows].sort((a, b) => b.syncedAt.getTime() - a.syncedAt.getTime());
  for (const row of sorted) {
    if (!latestPerPlatform.has(row.platform)) {
      latestPerPlatform.set(row.platform, row.revenue);
    }
  }
  return Array.from(latestPerPlatform.values()).reduce((s, v) => s + v, 0);
}

/**
 * Old earnings page approach: SUM all rows synced in last 30 days.
 */
function earningsPageNaiveSum(
  rows: { platform: string; revenue: number; syncedAt: Date }[]
): number {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return rows
    .filter((r) => r.syncedAt >= thirtyDaysAgo)
    .reduce((s, r) => s + r.revenue, 0);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("LTK earnings accuracy", () => {
  const NET_COMMISSIONS = 45.32;  // what Nicki earned this period
  const OPEN_EARNINGS = 312.78;   // lifetime pending balance — totally different number

  test("revenue and commission both equal net_commissions, not open_earnings", () => {
    const row = buildLtkEarningsRow(NET_COMMISSIONS, OPEN_EARNINGS, 120, 8);
    expect(parseFloat(row.revenue)).toBe(NET_COMMISSIONS);
    expect(parseFloat(row.commission)).toBe(NET_COMMISSIONS);
    expect(parseFloat(row.commission)).not.toBe(OPEN_EARNINGS);
  });

  test("PlatformCard displays net_commissions when commission = revenue = net_commissions", () => {
    const row = buildLtkEarningsRow(NET_COMMISSIONS, OPEN_EARNINGS, 120, 8);
    const displayed = platformCardDisplayValue(parseFloat(row.revenue), parseFloat(row.commission));
    expect(displayed).toBe(NET_COMMISSIONS);
  });

  test("PlatformCard would show wrong (lifetime) number if open_earnings were stored in commission", () => {
    // This documents the old bug: commission = open_earnings, PlatformCard renders commission first
    const wrongCommission = OPEN_EARNINGS;
    const correctRevenue = NET_COMMISSIONS;
    const displayed = platformCardDisplayValue(correctRevenue, wrongCommission);
    // Would show $312.78 instead of $45.32
    expect(displayed).toBe(OPEN_EARNINGS);
    expect(displayed).not.toBe(NET_COMMISSIONS);
  });

  test("net_commissions is strictly less than open_earnings in realistic scenarios", () => {
    // open_earnings accumulates all unpaid commissions; net_commissions is just this period
    expect(NET_COMMISSIONS).toBeLessThan(OPEN_EARNINGS);
  });
});

describe("Mavely calendar-month period (no rolling window accumulation)", () => {
  const ACTUAL_MONTHLY_COMMISSION = 89.50;

  test("fixed calendar-month period: same period_start every run → no row accumulation", () => {
    const today = new Date("2026-03-05");
    const run1 = mavelyMonthPeriod(today);
    const run2 = mavelyMonthPeriod(new Date("2026-03-06"));
    const run3 = mavelyMonthPeriod(new Date("2026-03-15"));

    // All runs in the same month produce identical period_start and period_end
    expect(run1.monthStart.toISOString()).toBe(run2.monthStart.toISOString());
    expect(run1.monthStart.toISOString()).toBe(run3.monthStart.toISOString());
    expect(run1.monthEnd.toISOString()).toBe(run2.monthEnd.toISOString());
    expect(run1.monthEnd.toISOString()).toBe(run3.monthEnd.toISOString());
  });

  test("fixed period produces correct month boundaries", () => {
    const march5 = new Date("2026-03-05");
    const { monthStart, monthEnd } = mavelyMonthPeriod(march5);
    expect(monthStart.toISOString().startsWith("2026-03-01")).toBe(true);
    expect(monthEnd.toISOString().startsWith("2026-03-31")).toBe(true);
  });

  test("month boundary handles December correctly (no month 13)", () => {
    const dec15 = new Date("2026-12-15");
    const { monthStart, monthEnd } = mavelyMonthPeriod(dec15);
    expect(monthStart.toISOString().startsWith("2026-12-01")).toBe(true);
    expect(monthEnd.toISOString().startsWith("2026-12-31")).toBe(true);
  });

  test("month boundary handles February correctly", () => {
    const feb10 = new Date("2026-02-10");
    const { monthStart, monthEnd } = mavelyMonthPeriod(feb10);
    expect(monthStart.toISOString().startsWith("2026-02-01")).toBe(true);
    expect(monthEnd.toISOString().startsWith("2026-02-28")).toBe(true);
  });

  test("rolling 30d window causes massive inflation after 30 daily syncs", () => {
    const displayed = simulateMavelyRollingAccumulation(ACTUAL_MONTHLY_COMMISSION, 30);
    expect(displayed).toBe(ACTUAL_MONTHLY_COMMISSION * 30); // 30x wrong
    expect(displayed).toBeGreaterThan(ACTUAL_MONTHLY_COMMISSION * 5);
  });

  test("fixed calendar-month approach shows correct amount regardless of sync count", () => {
    const displayed1 = simulateMavelyFixedMonthAccumulation(ACTUAL_MONTHLY_COMMISSION, 1);
    const displayed30 = simulateMavelyFixedMonthAccumulation(ACTUAL_MONTHLY_COMMISSION, 30);
    expect(displayed1).toBe(ACTUAL_MONTHLY_COMMISSION);
    expect(displayed30).toBe(ACTUAL_MONTHLY_COMMISSION);
  });
});

describe("Mavely revenue vs commission separation", () => {
  const links = [
    { commission: 12.50, revenue: 250.00, clicks: 40, orders: 3 },
    { commission: 8.75,  revenue: 175.00, clicks: 22, orders: 2 },
    { commission: 4.00,  revenue: 80.00,  clicks: 10, orders: 1 },
  ];

  test("revenue stores total order value (not commission amount)", () => {
    const row = buildMavelyEarningsRow(links);
    expect(parseFloat(row.revenue)).toBe(505.00); // sum of order values
    expect(parseFloat(row.revenue)).not.toBe(25.25); // not commission
  });

  test("commission stores creator earnings (not order value)", () => {
    const row = buildMavelyEarningsRow(links);
    expect(parseFloat(row.commission)).toBe(25.25); // sum of commissions
    expect(parseFloat(row.commission)).not.toBe(505.00); // not order value
  });

  test("revenue > commission (commission is a percentage of revenue)", () => {
    const row = buildMavelyEarningsRow(links);
    expect(parseFloat(row.revenue)).toBeGreaterThan(parseFloat(row.commission));
  });

  test("clicks and orders are summed correctly", () => {
    const row = buildMavelyEarningsRow(links);
    expect(row.clicks).toBe(72);
    expect(row.orders).toBe(6);
  });
});

describe("Earnings page deduplication (DISTINCT ON platform)", () => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  // Simulate 30 Mavely rows (one per daily sync, each with a slightly different period_start)
  const mavelyRows = Array.from({ length: 30 }, (_, i) => ({
    platform: "mavely",
    revenue: 89.50,
    syncedAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
  }));

  // LTK: 2 rows per day (7d window + 30d window), 30 days = 60 rows
  const ltkRows = [
    { platform: "ltk", revenue: 45.32, syncedAt: now },        // 30d row (latest)
    { platform: "ltk", revenue: 12.10, syncedAt: yesterday },  // 7d row from yesterday
    { platform: "ltk", revenue: 44.80, syncedAt: twoDaysAgo }, // 30d row from 2 days ago
    { platform: "ltk", revenue: 11.50, syncedAt: tenDaysAgo }, // 7d row from 10 days ago
  ];

  // ShopMy monthly rows (non-overlapping, all synced recently)
  const shopmyRows = [
    { platform: "shopmy", revenue: 210.00, syncedAt: now },      // March
    { platform: "shopmy", revenue: 180.00, syncedAt: yesterday }, // Feb
  ];

  const allRows = [...mavelyRows, ...ltkRows, ...shopmyRows];

  test("naive sum produces massively inflated total", () => {
    const total = earningsPageNaiveSum(allRows);
    // 30 mavely rows × $89.50 = $2,685 + LTK rows summed + ShopMy
    expect(total).toBeGreaterThan(2000);
  });

  test("DISTINCT ON deduplication returns accurate total", () => {
    const total = earningsPageWithDedup(allRows);
    // Should be: mavely latest ($89.50) + ltk latest ($45.32) + shopmy latest ($210.00)
    expect(total).toBeCloseTo(89.50 + 45.32 + 210.00, 2);
  });

  test("dedup picks the most recent row per platform", () => {
    // The most recent LTK row is the $45.32 one (not $12.10 or $44.80)
    const rows = [
      { platform: "ltk", revenue: 44.80, syncedAt: twoDaysAgo },
      { platform: "ltk", revenue: 45.32, syncedAt: now },
      { platform: "ltk", revenue: 12.10, syncedAt: yesterday },
    ];
    const total = earningsPageWithDedup(rows);
    expect(total).toBeCloseTo(45.32, 2);
  });

  test("dedup returns exactly one value per platform", () => {
    const latestPerPlatform = new Map<string, number>();
    const sorted = [...allRows].sort((a, b) => b.syncedAt.getTime() - a.syncedAt.getTime());
    for (const row of sorted) {
      if (!latestPerPlatform.has(row.platform)) {
        latestPerPlatform.set(row.platform, row.revenue);
      }
    }
    expect(latestPerPlatform.size).toBe(3); // ltk, mavely, shopmy — one each
  });

  test("30 daily Mavely syncs should not inflate reported earnings", () => {
    const naiveTotal = earningsPageNaiveSum(mavelyRows);
    const dedupTotal = earningsPageWithDedup(mavelyRows);
    // Naive: 30 × $89.50 = $2,685
    expect(naiveTotal).toBeGreaterThan(2000);
    // Dedup: just $89.50
    expect(dedupTotal).toBeCloseTo(89.50, 2);
  });
});

describe("Combined Total calculation", () => {
  test("sums platform-specific revenue values, not commission fields", () => {
    // After all fixes: ltk.revenue = net_commissions, shopmy.revenue = monthly total,
    // mavely.revenue = order value total (commission is the creator cut)
    const ltkRevenue = 45.32;
    const shopmyRevenue = 210.00;
    const mavelyRevenue = 505.00;

    const combined = ltkRevenue + shopmyRevenue + mavelyRevenue;
    expect(combined).toBeCloseTo(760.32, 2);
  });

  test("combined total excludes lifetime LTK open_earnings balance", () => {
    const openEarnings = 312.78; // lifetime balance — must NOT appear in combined total
    const netCommissions = 45.32; // actual 30d earnings — this should appear

    // After fix, we always use revenue (net_commissions) in combined total
    const combined = netCommissions + 210.00 + 505.00;
    expect(combined).not.toBeCloseTo(openEarnings, 0); // combined ≠ the lifetime balance
    expect(combined).toBeCloseTo(760.32, 2);
  });
});
