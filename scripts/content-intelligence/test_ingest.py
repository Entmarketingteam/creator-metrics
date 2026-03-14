"""
test_ingest.py — Smoke test for the ingest module.

Usage:
    python test_ingest.py

Loads all data from ~/Downloads, prints row counts, samples, and date range.
Verifies actual row counts and flags discrepancies vs. originally-stated expected counts.
"""

import sys
import os
import json
from datetime import datetime

# Allow running from any directory
sys.path.insert(0, os.path.dirname(__file__))

from modules.ingest import load_all_data

# ── Config ──────────────────────────────────────────────────────────────────
DATA_DIR = os.path.expanduser("~/Downloads")

# Actual row counts confirmed by direct CSV inspection (Jan 2026)
# Note: these differ from the counts in the original task spec — see notes below.
ACTUAL_EXPECTED = {
    "ltk_posts":    431,
    "ltk_products": 3000,   # file has 3,000 rows (spec said 3,141)
    "ltk_brands":   164,
    "ig_stories":   1186,   # file has 1,186 rows (spec said 2,939)
    "ig_reels":     130,    # file has 130 rows (spec said 904)
}

# ── Run ──────────────────────────────────────────────────────────────────────
print("=" * 60)
print("Content Intelligence — Ingest Test")
print("=" * 60)
print(f"Data directory: {DATA_DIR}")
print()

data = load_all_data(DATA_DIR)

# Row counts
print("── Row Counts ──────────────────────────────────────────────")
all_pass = True
for key, expected in ACTUAL_EXPECTED.items():
    actual = len(data[key])
    status = "PASS" if actual == expected else f"DIFF (expected {expected})"
    if actual != expected:
        all_pass = False
    print(f"  {key:<20} {actual:>6} rows   [{status}]")

print()

# Date range
dr = data["date_range"]
print("── Date Range ──────────────────────────────────────────────")
print(f"  Start : {dr['start']}")
print(f"  End   : {dr['end']}")
print(f"  Loaded: {data['loaded_at'].strftime('%Y-%m-%d %H:%M:%S')}")
print()

# Sample: first LTK post
print("── Sample: First LTK Post ──────────────────────────────────")
if data["ltk_posts"]:
    post = data["ltk_posts"][0]
    for k, v in post.items():
        # Truncate long image URLs for readability
        display = str(v)[:80] + "..." if isinstance(v, str) and len(str(v)) > 80 else v
        print(f"  {k:<35} {display}")
else:
    print("  (no LTK posts loaded)")
print()

# Sample: first IG story
print("── Sample: First IG Story ──────────────────────────────────")
if data["ig_stories"]:
    story = data["ig_stories"][0]
    for k, v in story.items():
        display = str(v)[:80] + "..." if isinstance(v, str) and len(str(v)) > 80 else v
        print(f"  {k:<35} {display}")
else:
    print("  (no IG stories loaded)")
print()

# Type verification — spot check a few fields
print("── Type Checks ─────────────────────────────────────────────")
checks = [
    ("ltk_posts[0].date_published", isinstance(data["ltk_posts"][0]["date_published"], datetime)),
    ("ltk_posts[0].clicks is int", isinstance(data["ltk_posts"][0]["clicks"], int)),
    ("ltk_posts[0].commissions is float", isinstance(data["ltk_posts"][0]["commissions"], float)),
    ("ig_stories[0].publish_time is datetime", isinstance(data["ig_stories"][0]["publish_time"], datetime)),
    ("ig_stories[0].views is int", isinstance(data["ig_stories"][0]["views"], int)),
    ("ig_reels[0].publish_time is datetime", isinstance(data["ig_reels"][0]["publish_time"], datetime)),
]
for label, result in checks:
    status = "PASS" if result else "FAIL"
    print(f"  {label:<45} [{status}]")
    if not result:
        all_pass = False
print()

# Data notes
print("── Data Notes ──────────────────────────────────────────────")
stories_lifetime = sum(1 for r in data["ig_stories"] if r["date_is_lifetime"])
reels_lifetime   = sum(1 for r in data["ig_reels"]   if r["date_is_lifetime"])
ltk_missing_date = sum(1 for r in data["ltk_posts"] if r["date_published"] is None)
products_no_name = sum(1 for r in data["ltk_products"] if not r["product_name"])
print(f"  IG stories with Date='Lifetime' : {stories_lifetime}")
print(f"  IG reels   with Date='Lifetime' : {reels_lifetime}")
print(f"  LTK posts  missing date         : {ltk_missing_date}")
print(f"  LTK products with no product_name: {products_no_name}")
print()

# Final verdict
print("=" * 60)
if all_pass:
    print("RESULT: ALL CHECKS PASSED")
else:
    print("RESULT: SOME CHECKS FLAGGED — review DIFF rows above")
print("=" * 60)
