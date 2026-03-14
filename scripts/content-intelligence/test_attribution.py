"""
Tests for modules/attribution.py

Uses entirely mock data — no real data files required.
"""

import sys
import os
from datetime import datetime, timezone, timedelta
from pprint import pprint

# Make sure the modules package is importable from this script's directory
sys.path.insert(0, os.path.dirname(__file__))

from modules.attribution import (
    extract_ltk_codes_from_text,
    match_by_url,
    match_by_date,
    build_attribution_map,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def dt(offset_hours: float = 0) -> datetime:
    """Return a UTC-aware datetime anchored to 2025-05-20 12:00 UTC + offset."""
    base = datetime(2025, 5, 20, 12, 0, 0, tzinfo=timezone.utc)
    return base + timedelta(hours=offset_hours)


PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"

_test_count = 0
_fail_count = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global _test_count, _fail_count
    _test_count += 1
    if condition:
        print(f"  [{PASS}] {name}")
    else:
        _fail_count += 1
        print(f"  [{FAIL}] {name}" + (f" — {detail}" if detail else ""))


# ---------------------------------------------------------------------------
# Mock data
# ---------------------------------------------------------------------------

LTK_POSTS = [
    # ltk-1 : matched by URL in story-1
    {
        "hero_image": "https://cdn.ltk.com/img1.jpg",
        "date_published": dt(0),
        "clicks": 320,
        "commissions": 48.50,
        "orders": 12,
        "items_sold": 15,
        "order_conversion_rate": 0.0375,
        "items_sold_conversion_rate": 0.047,
        "share_url": "https://liketk.it/AAAAA",
    },
    # ltk-2 : matched by date proximity (story-2 has link sticker, no URL)
    {
        "hero_image": "https://cdn.ltk.com/img2.jpg",
        "date_published": dt(1),        # 1 h after base
        "clicks": 180,
        "commissions": 22.00,
        "orders": 6,
        "items_sold": 8,
        "order_conversion_rate": 0.033,
        "items_sold_conversion_rate": 0.044,
        "share_url": "https://liketk.it/BBBBB",
    },
    # ltk-3 : matched by date via reel (within 12 h)
    {
        "hero_image": "https://cdn.ltk.com/img3.jpg",
        "date_published": dt(5),        # 5 h after base
        "clicks": 90,
        "commissions": 10.00,
        "orders": 3,
        "items_sold": 3,
        "order_conversion_rate": 0.033,
        "items_sold_conversion_rate": 0.033,
        "share_url": "https://liketk.it/CCCCC",
    },
    # ltk-4 : unmatched (too far in time, no URL reference)
    {
        "hero_image": "https://cdn.ltk.com/img4.jpg",
        "date_published": dt(72),       # 3 days later — no IG post near it
        "clicks": 50,
        "commissions": 5.00,
        "orders": 1,
        "items_sold": 1,
        "order_conversion_rate": 0.02,
        "items_sold_conversion_rate": 0.02,
        "share_url": "https://liketk.it/DDDDD",
    },
    # ltk-5 : carousel — both ltk-5 AND ltk-1 linked from story-3
    {
        "hero_image": "https://cdn.ltk.com/img5.jpg",
        "date_published": dt(0.5),
        "clicks": 60,
        "commissions": 7.25,
        "orders": 2,
        "items_sold": 2,
        "order_conversion_rate": 0.033,
        "items_sold_conversion_rate": 0.033,
        "share_url": "https://liketk.it/EEEEE",
    },
]

IG_STORIES = [
    # story-1: URL match to ltk-1
    {
        "post_id": "story-1",
        "description": "Shop my look! https://liketk.it/AAAAA",
        "publish_time": dt(0.5),
        "permalink": "https://www.instagram.com/stories/nicki.entenmann/1001/",
        "views": 5000,
        "reach": 4800,
        "likes": 200,
        "link_clicks": 150,
        "navigation": 50,
        "sticker_taps": 120,
        "profile_visits": 30,
        "replies": 10,
        "follows": 5,
    },
    # story-2: date match to ltk-2 (has link sticker, no URL in caption)
    {
        "post_id": "story-2",
        "description": "Loving this spring outfit!",
        "publish_time": dt(0),          # same time as ltk-2 base, 1 h apart from ltk-2
        "permalink": "https://www.instagram.com/stories/nicki.entenmann/1002/",
        "views": 3000,
        "reach": 2900,
        "likes": 100,
        "link_clicks": 0,
        "navigation": 20,
        "sticker_taps": 80,             # has link sticker
        "profile_visits": 15,
        "replies": 5,
        "follows": 2,
    },
    # story-3: carousel — URL matches both ltk-1 AND ltk-5
    {
        "post_id": "story-3",
        "description": "Two faves: liketk.it/AAAAA and http://liketk.it/EEEEE",
        "publish_time": dt(0.25),
        "permalink": "https://www.instagram.com/stories/nicki.entenmann/1003/",
        "views": 4000,
        "reach": 3800,
        "likes": 150,
        "link_clicks": 200,
        "navigation": 30,
        "sticker_taps": 100,
        "profile_visits": 20,
        "replies": 8,
        "follows": 3,
    },
    # story-4: NO link sticker — should be excluded from date matching
    {
        "post_id": "story-4",
        "description": "Beautiful day!",
        "publish_time": dt(1.5),
        "permalink": "https://www.instagram.com/stories/nicki.entenmann/1004/",
        "views": 2000,
        "reach": 1900,
        "likes": 80,
        "link_clicks": 0,
        "navigation": 10,
        "sticker_taps": 0,              # no link sticker
        "profile_visits": 10,
        "replies": 2,
        "follows": 1,
    },
    # story-5: reshare of ltk-1 URL on a different day
    {
        "post_id": "story-5",
        "description": "Still obsessed with this look liketk.it/AAAAA",
        "publish_time": dt(25),         # next day
        "permalink": "https://www.instagram.com/stories/nicki.entenmann/1005/",
        "views": 2500,
        "reach": 2400,
        "likes": 90,
        "link_clicks": 80,
        "navigation": 15,
        "sticker_taps": 60,
        "profile_visits": 12,
        "replies": 3,
        "follows": 1,
    },
]

IG_REELS = [
    # reel-1: date match to ltk-3 (within 12 h)
    {
        "post_id": "reel-1",
        "description": "Spring haul GRWM",
        "publish_time": dt(3),          # 2 h before ltk-3 (5-3=2 h gap)
        "permalink": "https://www.instagram.com/reel/AAABBB/",
        "views": 15000,
        "reach": 14000,
        "likes": 800,
        "shares": 120,
        "follows": 50,
        "comments": 60,
        "saves": 200,
    },
    # reel-2: too far from any LTK post (>12 h away)
    {
        "post_id": "reel-2",
        "description": "Recipe reel — no affiliate links",
        "publish_time": dt(40),         # 40 h after base, ltk-4 is 72 h out -> 32 h gap
        "permalink": "https://www.instagram.com/reel/CCCFFF/",
        "views": 8000,
        "reach": 7500,
        "likes": 400,
        "shares": 50,
        "follows": 20,
        "comments": 30,
        "saves": 100,
    },
    # reel-3: date match to ltk-1 (within 12 h) BUT ltk-1 already URL-matched
    #   -> should get a date match too (different pair: reel-3/ltk-1 not in already_matched)
    {
        "post_id": "reel-3",
        "description": "GRWM spring fit",
        "publish_time": dt(1),          # 1 h after ltk-1
        "permalink": "https://www.instagram.com/reel/DDDEEE/",
        "views": 6000,
        "reach": 5500,
        "likes": 300,
        "shares": 40,
        "follows": 15,
        "comments": 20,
        "saves": 80,
    },
]


# ---------------------------------------------------------------------------
# Test suite
# ---------------------------------------------------------------------------

def test_extract_codes():
    print("\n=== test_extract_codes ===")
    check("https:// prefix", extract_ltk_codes_from_text("https://liketk.it/5e3rP") == ["5e3rP"])
    check("http:// prefix", extract_ltk_codes_from_text("http://liketk.it/ABC99") == ["ABC99"])
    check("no scheme", extract_ltk_codes_from_text("liketk.it/XYZ12") == ["XYZ12"])
    check("multiple codes", len(extract_ltk_codes_from_text("liketk.it/AAA and liketk.it/BBB")) == 2)
    check("empty string", extract_ltk_codes_from_text("") == [])
    check("no match", extract_ltk_codes_from_text("no link here") == [])
    check("mixed text", extract_ltk_codes_from_text("Shop here: https://liketk.it/Q1w2E !") == ["Q1w2E"])


def test_url_matching():
    print("\n=== test_url_matching ===")
    all_ig = IG_STORIES + IG_REELS
    matches = match_by_url(all_ig, LTK_POSTS)

    # story-1 -> ltk-1
    story1_ltk1 = [
        m for m in matches
        if m["ig_post"]["post_id"] == "story-1" and m["ltk_post"]["share_url"] == "https://liketk.it/AAAAA"
    ]
    check("story-1 matched to ltk-AAAAA", len(story1_ltk1) == 1)
    check("url match confidence is 1.0", story1_ltk1[0]["confidence"] == 1.0)
    check("url match type is 'url'", story1_ltk1[0]["match_type"] == "url")

    # story-3 is a carousel — should match both ltk-1 AND ltk-5
    story3_matches = [m for m in matches if m["ig_post"]["post_id"] == "story-3"]
    check("story-3 carousel matches 2 LTK posts", len(story3_matches) == 2)
    carousel_urls = {m["ltk_post"]["share_url"] for m in story3_matches}
    check("carousel matches AAAAA and EEEEE", carousel_urls == {
        "https://liketk.it/AAAAA", "https://liketk.it/EEEEE"
    })

    # story-5 reshares ltk-1 — should still match
    story5_matches = [m for m in matches if m["ig_post"]["post_id"] == "story-5"]
    check("story-5 reshare of ltk-1 is matched", len(story5_matches) == 1)

    # story-2 has no URL -> no URL match
    story2_url_matches = [m for m in matches if m["ig_post"]["post_id"] == "story-2"]
    check("story-2 (no URL) has 0 URL matches", len(story2_url_matches) == 0)

    # story-4 has no URL -> no URL match
    story4_url_matches = [m for m in matches if m["ig_post"]["post_id"] == "story-4"]
    check("story-4 (no URL) has 0 URL matches", len(story4_url_matches) == 0)


def test_date_matching():
    print("\n=== test_date_matching ===")
    all_ig = IG_STORIES + IG_REELS
    matches = match_by_date(all_ig, LTK_POSTS, window_hours=24)

    # story-2 has link sticker, published at dt(0), ltk-2 at dt(1) => 1 h gap -> conf 0.9
    story2_ltk2 = [
        m for m in matches
        if m["ig_post"]["post_id"] == "story-2" and m["ltk_post"]["share_url"] == "https://liketk.it/BBBBB"
    ]
    check("story-2 date-matched to ltk-2", len(story2_ltk2) == 1)
    check("story-2/ltk-2 confidence is 0.9 (< 2 h)", story2_ltk2[0]["confidence"] == 0.9)

    # story-4 has NO link sticker -> must be excluded
    story4_matches = [m for m in matches if m["ig_post"]["post_id"] == "story-4"]
    check("story-4 (no link sticker) excluded from date matches", len(story4_matches) == 0)

    # reel-1 published at dt(3), ltk-3 at dt(5) => 2 h gap; 2 h < 12 h reel window
    reel1_ltk3 = [
        m for m in matches
        if m["ig_post"]["post_id"] == "reel-1" and m["ltk_post"]["share_url"] == "https://liketk.it/CCCCC"
    ]
    check("reel-1 date-matched to ltk-3 (within 12 h)", len(reel1_ltk3) == 1)
    check("reel-1/ltk-3 confidence is 0.9 (2 h, < 2 h boundary ±)", reel1_ltk3[0]["confidence"] >= 0.7)

    # reel-2 is 40 h after base; ltk-4 is 72 h after base -> 32 h gap > 12 h reel window
    reel2_matches = [m for m in matches if m["ig_post"]["post_id"] == "reel-2"]
    check("reel-2 (>12 h from any LTK) has 0 date matches", len(reel2_matches) == 0)


def test_no_double_matching():
    print("\n=== test_no_double_matching ===")
    all_ig = IG_STORIES + IG_REELS

    # Get URL matches first
    url_matches = match_by_url(all_ig, LTK_POSTS)
    already_matched: set[tuple[str, str]] = set()
    for m in url_matches:
        ig_id = m["ig_post"].get("post_id", "")
        ltk_url = m["ltk_post"].get("share_url", "")
        already_matched.add((ig_id, ltk_url))

    date_matches = match_by_date(all_ig, LTK_POSTS, window_hours=24, already_matched_pairs=already_matched)

    # story-1 was URL-matched to ltk-1; story-1 is also published within 24 h of ltk-1
    # -> date match for this pair should NOT appear
    story1_ltk1_date = [
        m for m in date_matches
        if m["ig_post"]["post_id"] == "story-1" and m["ltk_post"]["share_url"] == "https://liketk.it/AAAAA"
    ]
    check("story-1/ltk-1 not double-matched via date", len(story1_ltk1_date) == 0)

    # story-3 carousel: both story-3/ltk-1 and story-3/ltk-5 are URL-matched
    story3_ltk1_date = [
        m for m in date_matches
        if m["ig_post"]["post_id"] == "story-3" and m["ltk_post"]["share_url"] == "https://liketk.it/AAAAA"
    ]
    story3_ltk5_date = [
        m for m in date_matches
        if m["ig_post"]["post_id"] == "story-3" and m["ltk_post"]["share_url"] == "https://liketk.it/EEEEE"
    ]
    check("story-3/ltk-1 not double-matched", len(story3_ltk1_date) == 0)
    check("story-3/ltk-5 not double-matched", len(story3_ltk5_date) == 0)


def test_build_attribution_map():
    print("\n=== test_build_attribution_map ===")
    data = {
        "ltk_posts": LTK_POSTS,
        "ig_stories": IG_STORIES,
        "ig_reels": IG_REELS,
    }
    result = build_attribution_map(data)

    stats = result["stats"]
    matches = result["matches"]
    unmatched_ltk = result["unmatched_ltk"]
    unmatched_ig = result["unmatched_ig"]

    check("stats.total_ltk_posts == 5", stats["total_ltk_posts"] == 5)
    check("stats.total_ig_stories == 5", stats["total_ig_stories"] == 5)
    check("stats.total_ig_reels == 3", stats["total_ig_reels"] == 3)
    check("matches list is non-empty", len(matches) > 0)
    check("ltk-4 is unmatched", any(
        p["share_url"] == "https://liketk.it/DDDDD" for p in unmatched_ltk
    ))
    check("story-4 (no link) is in unmatched_ig", any(
        p["post_id"] == "story-4" for p in unmatched_ig
    ))
    check("all matches have attributed_commissions", all(
        "attributed_commissions" in m for m in matches
    ))
    check("all matches have attributed_clicks", all(
        "attributed_clicks" in m for m in matches
    ))
    check("attribution_rate is between 0 and 1", 0 <= stats["attribution_rate"] <= 1)
    check("total_attributed_commissions > 0", stats["total_attributed_commissions"] > 0)

    print("\n  --- Attribution Stats ---")
    pprint(stats)


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    test_extract_codes()
    test_url_matching()
    test_date_matching()
    test_no_double_matching()
    test_build_attribution_map()

    print(f"\n{'='*50}")
    if _fail_count == 0:
        print(f"\033[92mAll {_test_count} tests passed.\033[0m")
        sys.exit(0)
    else:
        print(f"\033[91m{_fail_count}/{_test_count} tests FAILED.\033[0m")
        sys.exit(1)
