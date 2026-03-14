"""
test_scoring.py — Smoke test for the scoring module using real Spring 2025 data.
"""

import sys
sys.path.insert(0, '/Users/ethanatchley/creator-metrics/scripts/content-intelligence')

from modules.ingest import load_all_data
from modules.scoring import run_scoring

DATA_DIR = '/Users/ethanatchley/Downloads'

print("=" * 60)
print("Loading real data from:", DATA_DIR)
print("=" * 60)

data = load_all_data(DATA_DIR)
print(f"  LTK posts loaded (all time): {len(data['ltk_posts'])}")
print(f"  IG stories loaded (raw rows): {len(data['ig_stories'])}")
print(f"  IG reels loaded (raw rows): {len(data['ig_reels'])}")
print()

results = run_scoring(data, {}, {}, {})

# ── Summary ──────────────────────────────────────────────────────────────────
summary = results['summary']
print("=" * 60)
print("SUMMARY")
print("=" * 60)
print(f"  Date range:            {summary['date_range']}")
print(f"  Total commissions:     ${summary['total_commissions']:,.2f}")
print(f"  Total LTK clicks:      {summary['total_ltk_clicks']:,}")
print(f"  Total story views:     {summary['total_story_views']:,}")
print(f"  Total reel views:      {summary['total_reel_views']:,}")
print(f"  Top brand:             {summary['top_brand']}")
print(f"  LTK posts scored:      {len(results['ltk_posts_scored'])}")
print(f"  IG stories scored:     {len(results['ig_stories_scored'])}")
print(f"  IG reels scored:       {len(results['ig_reels_scored'])}")
print()

# ── Top 3 LTK posts ──────────────────────────────────────────────────────────
print("=" * 60)
print("TOP 3 LTK POSTS (by composite_score)")
print("=" * 60)
top_ltk = sorted(
    results['ltk_posts_scored'],
    key=lambda p: p.get('composite_score') or 0.0,
    reverse=True
)[:3]
for i, p in enumerate(top_ltk, 1):
    dt = p.get('date_published')
    date_str = dt.strftime('%Y-%m-%d') if dt else 'unknown'
    comm = p.get('commissions') or 0.0
    tier = p.get('tier', '—')
    comp = p.get('composite_score', 0.0)
    clicks = p.get('clicks') or 0
    print(f"  {i}. {date_str}  commissions=${comm:.2f}  clicks={clicks}  "
          f"composite={comp}  tier={tier}")
print()

# ── Top 3 IG stories ─────────────────────────────────────────────────────────
print("=" * 60)
print("TOP 3 IG STORIES (by composite_score)")
print("=" * 60)
top_stories = sorted(
    results['ig_stories_scored'],
    key=lambda s: s.get('composite_score') or 0.0,
    reverse=True
)[:3]
for i, s in enumerate(top_stories, 1):
    pt = s.get('publish_time')
    date_str = pt.strftime('%Y-%m-%d') if pt else 'unknown'
    views = s.get('views') or 0
    tier  = s.get('tier', '—')
    comp  = s.get('composite_score', 0.0)
    eng   = s.get('engagement_rate', 0.0)
    print(f"  {i}. {date_str}  views={views:,}  engagement_rate={eng:.2%}  "
          f"composite={comp}  tier={tier}")
print()

# ── Weekly performance ───────────────────────────────────────────────────────
print("=" * 60)
print("WEEKLY PERFORMANCE (Mar–May 2025)")
print("=" * 60)
print(f"  {'Week':<10}  {'Commissions':>12}  {'Clicks':>8}  {'Posts':>6}  "
      f"{'Story Views':>12}  {'Holiday'}")
print("  " + "-" * 72)
for w in results['weekly_performance']:
    holiday = f"  ** {w['holiday_name']} **" if w['is_holiday_week'] else ""
    print(f"  {w['week_label']:<10}  ${w['ltk_commissions']:>10,.2f}  "
          f"{w['ltk_clicks']:>8,}  {w['post_count']:>6}  "
          f"{w['story_views']:>12,}{holiday}")
print()

# ── Insights ─────────────────────────────────────────────────────────────────
print("=" * 60)
print("GENERATED INSIGHTS")
print("=" * 60)
for i, insight in enumerate(results['insights'], 1):
    print(f"  {i}. {insight}")
print()

# ── Theme performance ─────────────────────────────────────────────────────────
print("=" * 60)
print("THEME PERFORMANCE")
print("=" * 60)
theme_perf = results['theme_performance']
sorted_themes = sorted(
    theme_perf.items(),
    key=lambda x: x[1]['total_commissions'],
    reverse=True
)
for theme, stats in sorted_themes:
    print(f"  {theme:<30}  posts={stats['count']:>3}  "
          f"avg=${stats['avg_commissions']:>8,.2f}  "
          f"total=${stats['total_commissions']:>10,.2f}  "
          f"avg_score={stats['avg_composite_score']}")
print()
print("Done.")
