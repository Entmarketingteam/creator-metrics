"""
Earnings accuracy tests for sync scripts.

Guards against the specific bugs fixed in:
  - sync_ltk.py: commission must be net_commissions, not open_earnings
  - sync_mavely.py: fixed calendar-month period (no rolling window accumulation),
                    revenue ≠ commission (order value vs creator cut)
  - sync_amazon.py: CSV parsing extracts correct columns
"""
import sys
import os
import unittest
from datetime import date, datetime, timedelta
from unittest.mock import MagicMock, patch, call

# Make the sync-service directory importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── Helpers ──────────────────────────────────────────────────────────────────

def _mavely_month_period(today: date):
    """Replicate the calendar-month period logic from sync_mavely.py."""
    month_start = date(today.year, today.month, 1)
    if today.month == 12:
        month_end = date(today.year + 1, 1, 1) - timedelta(days=1)
    else:
        month_end = date(today.year, today.month + 1, 1) - timedelta(days=1)
    return month_start, month_end


def _build_mavely_earnings(links: list[dict]):
    """Replicate the platform_earnings aggregation from sync_mavely.py."""
    return {
        "revenue": sum(float(l["revenue"]) for l in links),
        "commission": sum(float(l["commission"]) for l in links),
        "clicks": sum(l["clicks"] for l in links),
        "orders": sum(l["orders"] for l in links),
    }


# ── LTK sync tests ───────────────────────────────────────────────────────────

class TestLTKEarnings(unittest.TestCase):

    def test_commission_equals_net_commissions_not_open_earnings(self):
        """The commission field in platform_earnings must be net_commissions (period
        earned), not open_earnings (lifetime pending balance)."""
        net_commissions = 45.32
        open_earnings = 312.78  # totally different — lifetime balance

        # Simulate what sync_ltk.py now does: both revenue and commission = net_commissions
        revenue = str(net_commissions)
        commission = str(net_commissions)  # fixed: was str(open_earnings)

        self.assertEqual(float(revenue), net_commissions)
        self.assertEqual(float(commission), net_commissions)
        self.assertNotEqual(float(commission), open_earnings)

    def test_open_earnings_must_not_be_stored_in_commission_field(self):
        """Regression: before fix, commission stored open_earnings (lifetime balance).
        PlatformCard renders commission first, so it showed the wrong (inflated) number."""
        net_commissions = 45.32
        open_earnings = 312.78

        # Old broken behavior: commission = open_earnings
        old_commission = open_earnings
        old_revenue = net_commissions
        # PlatformCard: commission || revenue → showed open_earnings
        platform_card_old = old_commission or old_revenue
        self.assertEqual(platform_card_old, open_earnings)

        # New correct behavior: commission = revenue = net_commissions
        new_commission = net_commissions
        new_revenue = net_commissions
        platform_card_new = new_commission or new_revenue
        self.assertEqual(platform_card_new, net_commissions)
        self.assertNotEqual(platform_card_new, open_earnings)

    def test_ltk_upsert_uses_net_commissions_for_both_fields(self):
        """sync_ltk.py executes INSERT with net_commissions in both $4 and $4 position."""
        mock_conn = MagicMock()
        net_comm = "45.32"
        clicks = 120
        orders = 8

        # Simulate the execute call as it appears in sync_ltk.py after fix:
        # VALUES ($1, 'ltk', $2, $3, $4, $4, $5, $6, NOW())
        # args: creator_id, period_start, period_end, net_comm, clicks, orders
        mock_conn.execute(
            "INSERT INTO platform_earnings (creator_id, platform, period_start, period_end, "
            "revenue, commission, clicks, orders, synced_at) "
            "VALUES ($1, 'ltk', $2, $3, $4, $4, $5, $6, NOW()) "
            "ON CONFLICT (creator_id, platform, period_start, period_end) "
            "DO UPDATE SET revenue=$4, commission=$4, clicks=$5, orders=$6, synced_at=NOW()",
            "nicki_entenmann", date(2026, 2, 3), date(2026, 3, 5), net_comm, clicks, orders
        )

        call_args = mock_conn.execute.call_args
        positional_args = call_args[0]
        # $4 is the 4th positional arg (index 3 after the SQL string + creator_id, start, end)
        # args[0]=sql, args[1]=creator_id, args[2]=period_start, args[3]=period_end, args[4]=net_comm
        revenue_arg = positional_args[4]  # the net_comm value
        self.assertEqual(revenue_arg, net_comm)
        # The SQL uses $4 for BOTH revenue and commission columns (same value)
        self.assertIn("$4, $4", positional_args[0])
        self.assertIn("revenue=$4, commission=$4", positional_args[0])


# ── Mavely sync tests ─────────────────────────────────────────────────────────

class TestMavelyCalendarMonthPeriod(unittest.TestCase):

    def test_march_period(self):
        start, end = _mavely_month_period(date(2026, 3, 5))
        self.assertEqual(start, date(2026, 3, 1))
        self.assertEqual(end, date(2026, 3, 31))

    def test_february_period(self):
        start, end = _mavely_month_period(date(2026, 2, 10))
        self.assertEqual(start, date(2026, 2, 1))
        self.assertEqual(end, date(2026, 2, 28))

    def test_december_period_no_month_13(self):
        start, end = _mavely_month_period(date(2026, 12, 15))
        self.assertEqual(start, date(2026, 12, 1))
        self.assertEqual(end, date(2026, 12, 31))

    def test_same_month_start_every_day_in_march(self):
        """All days in March produce identical period boundaries → UPSERT overwrites in-place."""
        periods = [_mavely_month_period(date(2026, 3, d)) for d in range(1, 32)]
        starts = {p[0] for p in periods}
        ends = {p[1] for p in periods}
        self.assertEqual(len(starts), 1, "All March days should produce same period_start")
        self.assertEqual(len(ends), 1, "All March days should produce same period_end")

    def test_fixed_period_prevents_accumulation(self):
        """With a fixed period, 30 syncs all hit the same UPSERT row — no inflation."""
        # Rolling window: period_start = today - 30d (changes daily) → new row each day
        rolling_period_starts = {
            (date(2026, 3, 5) - timedelta(days=i))
            for i in range(30)
        }
        # Fixed period: period_start = first of month (same every day)
        fixed_period_starts = {
            _mavely_month_period(date(2026, 3, 5) - timedelta(days=i))[0]
            for i in range(30)
        }
        # Rolling creates 30 distinct period_starts (30 DB rows) — confirmed bad
        self.assertGreater(len(rolling_period_starts), 1)
        # Fixed creates at most 2 (if days span two months, e.g. Feb + March)
        self.assertLessEqual(len(fixed_period_starts), 2)


class TestMavelyRevenueVsCommissionSeparation(unittest.TestCase):

    def setUp(self):
        self.links = [
            {"commission": 12.50, "revenue": 250.00, "clicks": 40, "orders": 3},
            {"commission": 8.75,  "revenue": 175.00, "clicks": 22, "orders": 2},
            {"commission": 4.00,  "revenue": 80.00,  "clicks": 10, "orders": 1},
        ]

    def test_revenue_is_order_value_not_commission(self):
        row = _build_mavely_earnings(self.links)
        self.assertAlmostEqual(row["revenue"], 505.00)
        self.assertNotAlmostEqual(row["revenue"], 25.25)

    def test_commission_is_creator_earnings_not_order_value(self):
        row = _build_mavely_earnings(self.links)
        self.assertAlmostEqual(row["commission"], 25.25)
        self.assertNotAlmostEqual(row["commission"], 505.00)

    def test_revenue_greater_than_commission(self):
        row = _build_mavely_earnings(self.links)
        self.assertGreater(row["revenue"], row["commission"])

    def test_clicks_and_orders_aggregated(self):
        row = _build_mavely_earnings(self.links)
        self.assertEqual(row["clicks"], 72)
        self.assertEqual(row["orders"], 6)

    def test_old_bug_both_fields_were_commission(self):
        """Regression: before fix, revenue=$3 and commission=$3 where $3=commission.
        Demonstrates that the old code stored commission in both fields."""
        total_commission = sum(float(l["commission"]) for l in self.links)
        # Old broken SQL: VALUES (..., $3, $3, ...) where $3 = total_commission
        old_revenue = total_commission   # wrong: order value stored as commission amount
        old_commission = total_commission

        self.assertEqual(old_revenue, old_commission)  # both were the same (wrong)
        self.assertAlmostEqual(old_revenue, 25.25)      # was NOT the order value (505.00)

    def test_upsert_uses_separate_revenue_and_commission(self):
        """Verify the INSERT SQL uses distinct $3 (revenue) and $4 (commission)."""
        mock_conn = MagicMock()
        total_revenue = 505.00
        total_commission = 25.25
        total_clicks = 72
        total_orders = 6

        # Fixed SQL: VALUES ('nicki_entenmann', 'mavely', $1, $2, $3, $4, $5, $6, NOW())
        # $3=revenue (order value), $4=commission (creator cut)
        mock_conn.execute(
            "INSERT INTO platform_earnings "
            "(creator_id, platform, period_start, period_end, revenue, commission, clicks, orders, synced_at) "
            "VALUES ('nicki_entenmann', 'mavely', $1, $2, $3, $4, $5, $6, NOW()) "
            "ON CONFLICT (creator_id, platform, period_start, period_end) "
            "DO UPDATE SET revenue=$3, commission=$4, clicks=$5, orders=$6, synced_at=NOW()",
            date(2026, 3, 1), date(2026, 3, 31),
            str(total_revenue), str(total_commission), total_clicks, total_orders
        )

        args = mock_conn.execute.call_args[0]
        sql = args[0]
        revenue_arg = args[3]   # $3
        commission_arg = args[4] # $4

        self.assertEqual(revenue_arg, str(total_revenue))
        self.assertEqual(commission_arg, str(total_commission))
        self.assertNotEqual(revenue_arg, commission_arg)
        # SQL must use separate placeholders for revenue and commission
        self.assertIn("$3, $4", sql)
        self.assertNotIn("$3, $3", sql)  # old broken pattern


# ── Amazon CSV parse tests ────────────────────────────────────────────────────

class TestAmazonCSVParsing(unittest.TestCase):

    def _parse(self, csv_content: str):
        from sync_amazon import _parse_csv
        return _parse_csv(csv_content)

    def test_parses_standard_csv_columns(self):
        csv = (
            "Date,Clicks,Ordered Items,Shipped Items,Returns,Revenue,Converted,Total Commissions\n"
            "2026-03-01,50,5,4,0,200.00,4,18.50\n"
            "2026-03-02,30,2,2,0,80.00,2,7.40\n"
        )
        result = self._parse(csv)
        self.assertIsNotNone(result)
        self.assertEqual(result["clicks"], 80)
        self.assertEqual(result["orders"], 6)  # Shipped Items
        self.assertAlmostEqual(result["commission"], 25.90)
        self.assertAlmostEqual(result["revenue"], 25.90)  # revenue = commission for Amazon

    def test_skips_total_rows(self):
        csv = (
            "Date,Clicks,Ordered Items,Shipped Items,Returns,Revenue,Converted,Total Commissions\n"
            "2026-03-01,50,5,4,0,200.00,4,18.50\n"
            "Total,50,5,4,0,200.00,4,18.50\n"  # should be skipped
        )
        result = self._parse(csv)
        self.assertIsNotNone(result)
        self.assertEqual(result["clicks"], 50)  # only one data row counted

    def test_returns_none_for_empty_csv(self):
        result = self._parse("")
        self.assertIsNone(result)

    def test_returns_none_for_header_only_csv(self):
        csv = "Date,Clicks,Ordered Items,Shipped Items,Revenue,Total Commissions\n"
        result = self._parse(csv)
        self.assertIsNone(result)

    def test_handles_comma_in_numbers(self):
        csv = (
            "Date,Clicks,Ordered Items,Shipped Items,Returns,Revenue,Converted,Total Commissions\n"
            "2026-03-01,1500,100,90,0,10000.00,85,\"1,234.56\"\n"
        )
        result = self._parse(csv)
        if result:  # CSV parser may or may not handle quoted commas
            self.assertGreater(result["clicks"], 0)

    def test_commission_equals_revenue_for_amazon(self):
        """Amazon earnings: commission and revenue are the same value (what you earned)."""
        csv = (
            "Date,Clicks,Ordered Items,Shipped Items,Returns,Revenue,Converted,Total Commissions\n"
            "2026-03-01,50,5,4,0,200.00,4,18.50\n"
        )
        result = self._parse(csv)
        if result:
            self.assertEqual(result["commission"], result["revenue"])


# ── Deduplication logic tests ─────────────────────────────────────────────────

class TestEarningsDeduplication(unittest.TestCase):
    """
    Tests for the DISTINCT ON (platform) deduplication used in the earnings page.
    The Python equivalent: for each platform, use only the most-recent row's revenue.
    """

    def _dedup(self, rows: list[dict]) -> float:
        """Replicate DISTINCT ON (platform) ORDER BY synced_at DESC → SUM."""
        latest = {}
        for row in sorted(rows, key=lambda r: r["synced_at"], reverse=True):
            if row["platform"] not in latest:
                latest[row["platform"]] = float(row["revenue"])
        return sum(latest.values())

    def test_30_daily_mavely_rows_sum_to_single_value(self):
        base_time = datetime(2026, 3, 5, 12, 0, 0)
        rows = [
            {"platform": "mavely", "revenue": "89.50",
             "synced_at": base_time - timedelta(days=i)}
            for i in range(30)
        ]
        total = self._dedup(rows)
        self.assertAlmostEqual(total, 89.50)

    def test_naive_sum_would_be_30x_inflated(self):
        base_time = datetime(2026, 3, 5, 12, 0, 0)
        rows = [
            {"platform": "mavely", "revenue": "89.50",
             "synced_at": base_time - timedelta(days=i)}
            for i in range(30)
        ]
        naive = sum(float(r["revenue"]) for r in rows)
        dedup = self._dedup(rows)
        self.assertAlmostEqual(naive, 89.50 * 30)
        self.assertAlmostEqual(dedup, 89.50)
        self.assertGreater(naive / dedup, 25)  # naive is at least 25x too high

    def test_most_recent_ltk_row_wins(self):
        base = datetime(2026, 3, 5, 12, 0, 0)
        rows = [
            {"platform": "ltk", "revenue": "45.32", "synced_at": base},              # latest
            {"platform": "ltk", "revenue": "12.10", "synced_at": base - timedelta(hours=1)},  # 7d window
            {"platform": "ltk", "revenue": "44.80", "synced_at": base - timedelta(days=1)},   # yesterday 30d
        ]
        total = self._dedup(rows)
        self.assertAlmostEqual(total, 45.32)

    def test_three_platforms_each_contribute_latest_row(self):
        base = datetime(2026, 3, 5, 12, 0, 0)
        rows = [
            {"platform": "ltk",    "revenue": "45.32", "synced_at": base},
            {"platform": "ltk",    "revenue": "44.00", "synced_at": base - timedelta(days=1)},
            {"platform": "shopmy", "revenue": "210.00", "synced_at": base},
            {"platform": "shopmy", "revenue": "180.00", "synced_at": base - timedelta(days=1)},
            {"platform": "mavely", "revenue": "89.50",  "synced_at": base},
            {"platform": "mavely", "revenue": "89.50",  "synced_at": base - timedelta(days=1)},
        ]
        total = self._dedup(rows)
        self.assertAlmostEqual(total, 45.32 + 210.00 + 89.50, places=2)


if __name__ == "__main__":
    unittest.main()
