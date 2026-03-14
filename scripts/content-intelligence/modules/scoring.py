"""
scoring.py — Performance scoring module for the Content Intelligence Pipeline.

Scores Nicki Entenmann's Spring 2025 content to identify what drives
affiliate revenue and engagement. Output feeds directly into the HTML report.
"""

from datetime import datetime, date, timedelta
from typing import Optional


# ---------------------------------------------------------------------------
# Spring 2025 date window
# ---------------------------------------------------------------------------

_SPRING_START = datetime(2025, 3, 1)
_SPRING_END   = datetime(2025, 5, 31, 23, 59, 59)

# Holiday weeks — Monday-aligned week start dates
_HOLIDAYS = {
    "2025-03-17": "St. Patrick's Day",
    "2025-04-14": "Easter",   # week of Apr 14 contains Apr 20
    "2025-05-26": "Memorial Day",
}

# Holiday reference dates (used to find which Monday-week they fall in)
_HOLIDAY_DATES = {
    date(2025, 3, 17): "St. Patrick's Day",
    date(2025, 4, 20): "Easter",
    date(2025, 5, 26): "Memorial Day",
}


# ---------------------------------------------------------------------------
# Percentile ranking helper
# ---------------------------------------------------------------------------

def percentile_rank(value: float, all_values: list) -> float:
    """Returns 0-100 percentile rank of value in all_values."""
    if not all_values or value is None:
        return 50.0
    sorted_vals = sorted(v for v in all_values if v is not None)
    if not sorted_vals:
        return 50.0
    rank = sum(1 for v in sorted_vals if v <= value) / len(sorted_vals)
    return round(rank * 100, 1)


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------

def _naive_dt(dt) -> Optional[datetime]:
    """Strip timezone info from a datetime."""
    if dt is None:
        return None
    if hasattr(dt, 'tzinfo') and dt.tzinfo is not None:
        return dt.replace(tzinfo=None)
    return dt


def _in_spring(dt: Optional[datetime]) -> bool:
    """Return True if dt falls within Mar 1 – May 31, 2025."""
    if dt is None:
        return False
    naive = _naive_dt(dt)
    return _SPRING_START <= naive <= _SPRING_END


def _monday_of(dt: datetime) -> date:
    """Return the Monday of the week containing dt."""
    naive = _naive_dt(dt)
    d = naive.date() if isinstance(naive, datetime) else naive
    return d - timedelta(days=d.weekday())


# ---------------------------------------------------------------------------
# LTK scoring
# ---------------------------------------------------------------------------

def score_ltk_post(post: dict, all_posts: Optional[list] = None) -> dict:
    """
    Add performance scores to an LTK post.

    Returns post with added fields:
    - revenue_score: float 0-100 (percentile rank of commissions)
    - click_score: float 0-100 (percentile rank of clicks)
    - conversion_score: float 0-100 (percentile rank of order_conversion_rate)
    - composite_score: float 0-100 (50% revenue, 30% clicks, 20% conversion)
    - tier: 'hero' | 'strong' | 'average' | 'underperformer'

    When all_posts is provided, ranks are computed against the full dataset.
    When None, scores default to 50.0 (call score_ltk_posts_batch instead).
    """
    result = dict(post)
    if all_posts is None:
        all_posts = [post]

    all_commissions   = [p.get("commissions") for p in all_posts]
    all_clicks        = [p.get("clicks") for p in all_posts]
    all_conversions   = [p.get("order_conversion_rate") for p in all_posts]

    rev  = percentile_rank(post.get("commissions"), all_commissions)
    clk  = percentile_rank(post.get("clicks"), all_clicks)
    conv = percentile_rank(post.get("order_conversion_rate"), all_conversions)

    composite = round(rev * 0.50 + clk * 0.30 + conv * 0.20, 1)

    if composite >= 90:
        tier = "hero"
    elif composite >= 75:
        tier = "strong"
    elif composite >= 25:
        tier = "average"
    else:
        tier = "underperformer"

    result.update({
        "revenue_score":     rev,
        "click_score":       clk,
        "conversion_score":  conv,
        "composite_score":   composite,
        "tier":              tier,
    })
    return result


def score_ltk_posts_batch(posts: list) -> list:
    """Score a list of LTK posts with percentile ranks computed across the batch."""
    all_commissions = [p.get("commissions") for p in posts]
    all_clicks      = [p.get("clicks") for p in posts]
    all_conversions = [p.get("order_conversion_rate") for p in posts]

    scored = []
    for post in posts:
        result = dict(post)
        rev  = percentile_rank(post.get("commissions"), all_commissions)
        clk  = percentile_rank(post.get("clicks"), all_clicks)
        conv = percentile_rank(post.get("order_conversion_rate"), all_conversions)
        composite = round(rev * 0.50 + clk * 0.30 + conv * 0.20, 1)

        if composite >= 90:
            tier = "hero"
        elif composite >= 75:
            tier = "strong"
        elif composite >= 25:
            tier = "average"
        else:
            tier = "underperformer"

        result.update({
            "revenue_score":    rev,
            "click_score":      clk,
            "conversion_score": conv,
            "composite_score":  composite,
            "tier":             tier,
        })
        scored.append(result)
    return scored


# ---------------------------------------------------------------------------
# IG Story scoring
# ---------------------------------------------------------------------------

def score_ig_story(story: dict, all_stories: Optional[list] = None) -> dict:
    """
    Add engagement scores to an IG story.

    Added fields:
    - engagement_rate: (likes + replies + follows) / reach
    - link_engagement_rate: (link_clicks + sticker_taps) / views
    - virality_score: 0-100 percentile rank of views
    - engagement_score: 0-100 percentile rank of engagement_rate
    - composite_score: 50% virality + 35% engagement + 15% SEO
    - tier: 'viral' | 'hero' | 'strong' | 'average' | 'underperformer'
    """
    result = dict(story)
    if all_stories is None:
        all_stories = [story]

    reach   = story.get("reach") or 0
    views   = story.get("views") or 0
    likes   = story.get("likes") or 0
    replies = story.get("replies") or 0
    follows = story.get("follows") or 0
    link_clicks  = story.get("link_clicks") or 0
    sticker_taps = story.get("sticker_taps") or 0

    eng_rate  = round((likes + replies + follows) / reach, 4) if reach > 0 else 0.0
    link_rate = round((link_clicks + sticker_taps) / views, 4) if views > 0 else 0.0

    all_views    = [s.get("views") for s in all_stories]
    all_eng      = []
    for s in all_stories:
        r = s.get("reach") or 0
        if r > 0:
            e = ((s.get("likes") or 0) + (s.get("replies") or 0) + (s.get("follows") or 0)) / r
        else:
            e = 0.0
        all_eng.append(e)

    virality      = percentile_rank(views, all_views)
    eng_score     = percentile_rank(eng_rate, all_eng)
    seo_score_pct = (story.get("seo_score") or 0) / 100.0 * 100.0
    composite     = round(virality * 0.50 + eng_score * 0.35 + seo_score_pct * 0.15, 1)

    if composite >= 95:
        tier = "viral"
    elif composite >= 85:
        tier = "hero"
    elif composite >= 70:
        tier = "strong"
    elif composite >= 25:
        tier = "average"
    else:
        tier = "underperformer"

    result.update({
        "engagement_rate":      eng_rate,
        "link_engagement_rate": link_rate,
        "virality_score":       virality,
        "engagement_score":     eng_score,
        "seo_score":            seo_score_pct,
        "composite_score":      composite,
        "tier":                 tier,
    })
    return result


def score_ig_stories_batch(stories: list) -> list:
    """Score a list of IG stories with percentile ranks computed across the batch.

    Composite formula: 50% virality + 35% engagement + 15% SEO.
    """
    all_views = [s.get("views") for s in stories]
    all_eng = []
    for s in stories:
        r = s.get("reach") or 0
        if r > 0:
            e = ((s.get("likes") or 0) + (s.get("replies") or 0) + (s.get("follows") or 0)) / r
        else:
            e = 0.0
        all_eng.append(e)
    all_seo = [s.get("seo_score") or 0 for s in stories]

    scored = []
    for story in stories:
        result = dict(story)
        reach   = story.get("reach") or 0
        views   = story.get("views") or 0
        likes   = story.get("likes") or 0
        replies = story.get("replies") or 0
        follows = story.get("follows") or 0
        link_clicks  = story.get("link_clicks") or 0
        sticker_taps = story.get("sticker_taps") or 0

        eng_rate  = round((likes + replies + follows) / reach, 4) if reach > 0 else 0.0
        link_rate = round((link_clicks + sticker_taps) / views, 4) if views > 0 else 0.0

        seo_raw       = story.get("seo_score") or 0
        virality      = percentile_rank(views, all_views)
        eng_score     = percentile_rank(eng_rate, all_eng)
        seo_score_pct = percentile_rank(seo_raw, all_seo)
        composite     = round(virality * 0.50 + eng_score * 0.35 + seo_score_pct * 0.15, 1)

        if composite >= 95:
            tier = "viral"
        elif composite >= 85:
            tier = "hero"
        elif composite >= 70:
            tier = "strong"
        elif composite >= 25:
            tier = "average"
        else:
            tier = "underperformer"

        result.update({
            "engagement_rate":      eng_rate,
            "link_engagement_rate": link_rate,
            "virality_score":       virality,
            "engagement_score":     eng_score,
            "seo_score":            seo_score_pct,
            "composite_score":      composite,
            "tier":                 tier,
        })
        scored.append(result)
    return scored


# ---------------------------------------------------------------------------
# IG Reel scoring
# ---------------------------------------------------------------------------

def score_ig_reel(reel: dict, all_reels: Optional[list] = None) -> dict:
    """
    Add engagement scores to an IG reel.

    Added fields:
    - engagement_rate: (likes + comments + saves + shares) / views
    - save_rate: saves / views
    - share_rate: shares / views
    - virality_score: 0-100 percentile rank of views
    - composite_score: 44% virality + 27% engagement + 17% saves + 12% SEO
    - tier: 'viral' | 'hero' | 'strong' | 'average' | 'underperformer'
    """
    result = dict(reel)
    if all_reels is None:
        all_reels = [reel]

    views    = reel.get("views") or 0
    likes    = reel.get("likes") or 0
    comments = reel.get("comments") or 0
    saves    = reel.get("saves") or 0
    shares   = reel.get("shares") or 0

    eng_rate   = round((likes + comments + saves + shares) / views, 4) if views > 0 else 0.0
    save_rate  = round(saves / views, 4) if views > 0 else 0.0
    share_rate = round(shares / views, 4) if views > 0 else 0.0

    all_views    = [r.get("views") for r in all_reels]
    all_eng      = []
    all_saves    = []
    for r in all_reels:
        v = r.get("views") or 0
        if v > 0:
            e = ((r.get("likes") or 0) + (r.get("comments") or 0) +
                 (r.get("saves") or 0) + (r.get("shares") or 0)) / v
        else:
            e = 0.0
        all_eng.append(e)
        all_saves.append(r.get("saves"))

    virality      = percentile_rank(views, all_views)
    eng_score     = percentile_rank(eng_rate, all_eng)
    save_score    = percentile_rank(saves, all_saves)
    seo_score_pct = (reel.get("seo_score") or 0) / 100.0 * 100.0
    composite     = round(virality * 0.44 + eng_score * 0.27 + save_score * 0.17 + seo_score_pct * 0.12, 1)

    if composite >= 95:
        tier = "viral"
    elif composite >= 85:
        tier = "hero"
    elif composite >= 70:
        tier = "strong"
    elif composite >= 25:
        tier = "average"
    else:
        tier = "underperformer"

    result.update({
        "engagement_rate": eng_rate,
        "save_rate":       save_rate,
        "share_rate":      share_rate,
        "virality_score":  virality,
        "seo_score":       seo_score_pct,
        "composite_score": composite,
        "tier":            tier,
    })
    return result


def score_ig_reels_batch(reels: list) -> list:
    """Score a list of IG reels with percentile ranks computed across the batch.

    Composite formula: 44% virality + 27% engagement + 17% saves + 12% SEO.
    """
    all_views = [r.get("views") for r in reels]
    all_eng = []
    all_saves = []
    for r in reels:
        v = r.get("views") or 0
        if v > 0:
            e = ((r.get("likes") or 0) + (r.get("comments") or 0) +
                 (r.get("saves") or 0) + (r.get("shares") or 0)) / v
        else:
            e = 0.0
        all_eng.append(e)
        all_saves.append(r.get("saves"))
    all_seo_r = [r.get("seo_score") or 0 for r in reels]

    scored = []
    for reel in reels:
        result = dict(reel)
        views    = reel.get("views") or 0
        likes    = reel.get("likes") or 0
        comments = reel.get("comments") or 0
        saves    = reel.get("saves") or 0
        shares   = reel.get("shares") or 0

        eng_rate   = round((likes + comments + saves + shares) / views, 4) if views > 0 else 0.0
        save_rate  = round(saves / views, 4) if views > 0 else 0.0
        share_rate = round(shares / views, 4) if views > 0 else 0.0

        seo_raw       = reel.get("seo_score") or 0
        virality      = percentile_rank(views, all_views)
        eng_score     = percentile_rank(eng_rate, all_eng)
        save_score    = percentile_rank(saves, all_saves)
        seo_score_pct = percentile_rank(seo_raw, all_seo_r)
        composite     = round(virality * 0.44 + eng_score * 0.27 + save_score * 0.17 + seo_score_pct * 0.12, 1)

        if composite >= 95:
            tier = "viral"
        elif composite >= 85:
            tier = "hero"
        elif composite >= 70:
            tier = "strong"
        elif composite >= 25:
            tier = "average"
        else:
            tier = "underperformer"

        result.update({
            "engagement_rate": eng_rate,
            "save_rate":       save_rate,
            "share_rate":      share_rate,
            "virality_score":  virality,
            "seo_score":       seo_score_pct,
            "composite_score": composite,
            "tier":            tier,
        })
        scored.append(result)
    return scored


# ---------------------------------------------------------------------------
# Theme performance
# ---------------------------------------------------------------------------

def compute_theme_performance(ltk_posts_scored: list) -> dict:
    """
    Group scored LTK posts by visual theme and compute per-theme stats.

    Requires visual_analysis field on posts (may be None for some).
    Ungrouped posts (no theme) are placed under 'Uncategorized'.

    Returns:
        {
            theme_name: {
                'count': int,
                'avg_commissions': float,
                'total_commissions': float,
                'avg_clicks': int,
                'avg_composite_score': float,
                'top_post': dict
            }
        }
    """
    buckets: dict = {}

    for post in ltk_posts_scored:
        va = post.get("visual_analysis")
        if va and isinstance(va, dict):
            themes_list = va.get("themes") or []
            theme = themes_list[0] if themes_list else "Uncategorized"
        else:
            theme = "Uncategorized"

        if theme not in buckets:
            buckets[theme] = []
        buckets[theme].append(post)

    result = {}
    for theme, posts in buckets.items():
        commissions = [p.get("commissions") or 0.0 for p in posts]
        clicks      = [p.get("clicks") or 0 for p in posts]
        composites  = [p.get("composite_score") or 0.0 for p in posts]

        total_comm = sum(commissions)
        avg_comm   = round(total_comm / len(posts), 2) if posts else 0.0
        avg_clicks = round(sum(clicks) / len(posts)) if posts else 0
        avg_comp   = round(sum(composites) / len(posts), 1) if posts else 0.0

        top_post = max(posts, key=lambda p: p.get("composite_score") or 0.0)

        result[theme] = {
            "count":              len(posts),
            "avg_commissions":    avg_comm,
            "total_commissions":  round(total_comm, 2),
            "avg_clicks":         avg_clicks,
            "avg_composite_score": avg_comp,
            "top_post":           top_post,
        }

    return result


# ---------------------------------------------------------------------------
# Weekly performance
# ---------------------------------------------------------------------------

def compute_weekly_performance(ltk_posts: list, ig_stories: list) -> list:
    """
    Bucket into Monday-aligned weeks across Mar 1 – May 31, 2025.

    Returns list of week dicts sorted by week_start ascending.
    """
    # Build all Monday-start weeks in the window
    week_start = date(2025, 3, 3)   # first Monday on or after Mar 1
    # Find correct first Monday >= Mar 1
    d = date(2025, 3, 1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    week_start = d

    window_end = date(2025, 5, 31)
    weeks = []
    w = week_start
    while w <= window_end:
        weeks.append(w)
        w += timedelta(days=7)

    # Build lookup: week_start_date -> index
    week_index = {w: i for i, w in enumerate(weeks)}

    # Initialize buckets
    buckets = []
    for w in weeks:
        # Determine if holiday week
        holiday_name = None
        for hdate, hname in _HOLIDAY_DATES.items():
            if _monday_of(datetime.combine(hdate, datetime.min.time())) == w:
                holiday_name = hname
                break

        buckets.append({
            "week_start":        w.strftime("%Y-%m-%d"),
            "week_label":        w.strftime("%b %-d"),
            "ltk_commissions":   0.0,
            "ltk_clicks":        0,
            "story_views":       0,
            "story_link_clicks": 0,
            "post_count":        0,
            "is_holiday_week":   holiday_name is not None,
            "holiday_name":      holiday_name,
        })

    def _get_week_idx(dt: Optional[datetime]) -> Optional[int]:
        if dt is None:
            return None
        naive = _naive_dt(dt)
        if not _in_spring(naive):
            return None
        mon = _monday_of(naive)
        return week_index.get(mon)

    # Aggregate LTK posts
    for post in ltk_posts:
        idx = _get_week_idx(post.get("date_published"))
        if idx is None:
            continue
        buckets[idx]["ltk_commissions"] += post.get("commissions") or 0.0
        buckets[idx]["ltk_clicks"]      += post.get("clicks") or 0
        buckets[idx]["post_count"]      += 1

    # Aggregate IG stories — use only Lifetime rows (date_is_lifetime=True)
    # or rows without a specific date (skip daily breakdown rows)
    for story in ig_stories:
        if story.get("date_is_lifetime"):
            # Use publish_time to bin
            idx = _get_week_idx(story.get("publish_time"))
        else:
            # Skip daily-breakdown rows
            continue
        if idx is None:
            continue
        buckets[idx]["story_views"]       += story.get("views") or 0
        buckets[idx]["story_link_clicks"] += story.get("link_clicks") or 0

    # Round commissions
    for b in buckets:
        b["ltk_commissions"] = round(b["ltk_commissions"], 2)

    return buckets


# ---------------------------------------------------------------------------
# Insight generation
# ---------------------------------------------------------------------------

def generate_insights(
    ltk_posts_scored: list,
    ig_stories_scored: list,
    attribution: dict,
    theme_performance: dict,
) -> list:
    """
    Generate 3-5 data-driven insight strings for the report.
    Returns actual computed insights, not templates.
    """
    insights = []

    if not ltk_posts_scored:
        return ["No LTK data available for Spring 2025."]

    # --- Insight 1: Top 10 posts share of total commissions ---
    all_comm = sorted(
        [p.get("commissions") or 0.0 for p in ltk_posts_scored],
        reverse=True
    )
    total_comm = sum(all_comm)
    top10_comm = sum(all_comm[:10])
    if total_comm > 0:
        pct = round(top10_comm / total_comm * 100)
        insights.append(
            f"Your top 10 LTK posts generated {pct}% of total Spring commissions "
            f"(${top10_comm:,.0f} of ${total_comm:,.0f})"
        )

    # --- Insight 2: Best theme vs average ---
    themes_with_posts = {k: v for k, v in theme_performance.items() if v["count"] >= 2}
    if len(themes_with_posts) >= 2:
        avg_all = total_comm / len(ltk_posts_scored) if ltk_posts_scored else 0
        best_theme = max(themes_with_posts.items(), key=lambda x: x[1]["avg_commissions"])
        bname, bdata = best_theme
        ratio = round(bdata["avg_commissions"] / avg_all, 1) if avg_all > 0 else 0
        if ratio > 1.1 and bname != "Uncategorized":
            insights.append(
                f"{bname} posts drove {ratio}x more revenue than average "
                f"(${bdata['avg_commissions']:,.0f} vs ${avg_all:,.0f} avg per post)"
            )

    # --- Insight 3: Best revenue week ---
    weekly = compute_weekly_performance(ltk_posts_scored, ig_stories_scored)
    best_week = max(weekly, key=lambda w: w["ltk_commissions"]) if weekly else None
    if best_week and best_week["ltk_commissions"] > 0:
        holiday_tag = f" ({best_week['holiday_name']})" if best_week["is_holiday_week"] else ""
        insights.append(
            f"Week of {best_week['week_label']}{holiday_tag} was your #1 revenue week "
            f"at ${best_week['ltk_commissions']:,.0f}"
        )

    # --- Insight 4: Stories with link engagement driving LTK clicks ---
    linked_stories = [s for s in ig_stories_scored if (s.get("link_clicks") or 0) > 0]
    unlinked_stories = [s for s in ig_stories_scored if (s.get("link_clicks") or 0) == 0]
    if linked_stories and unlinked_stories:
        avg_linked   = sum(s.get("views") or 0 for s in linked_stories) / len(linked_stories)
        avg_unlinked = sum(s.get("views") or 0 for s in unlinked_stories) / len(unlinked_stories)
        if avg_unlinked > 0:
            lift = round((avg_linked - avg_unlinked) / avg_unlinked * 100)
            if lift > 0:
                insights.append(
                    f"Stories with link stickers had {lift}% higher views on average "
                    f"({avg_linked:,.0f} vs {avg_unlinked:,.0f})"
                )
            elif lift < 0:
                insights.append(
                    f"Stories with link stickers averaged {avg_linked:,.0f} views vs "
                    f"{avg_unlinked:,.0f} for non-linked stories"
                )

    # --- Insight 5: Conversion rate leaders ---
    posts_with_conv = [p for p in ltk_posts_scored if p.get("order_conversion_rate") is not None]
    if posts_with_conv:
        top_conv = max(posts_with_conv, key=lambda p: p.get("order_conversion_rate") or 0)
        avg_conv = sum(p.get("order_conversion_rate") or 0 for p in posts_with_conv) / len(posts_with_conv)
        best_rate = top_conv.get("order_conversion_rate") or 0
        if best_rate > avg_conv * 1.5:
            pub = top_conv.get("date_published")
            date_str = _naive_dt(pub).strftime("%b %-d") if pub else "unknown date"
            ratio = round(best_rate / avg_conv, 1) if avg_conv > 0 else 0
            insights.append(
                f"Your best-converting LTK post ({date_str}) converted at {best_rate:.1%} — "
                f"{ratio}x the Spring average of {avg_conv:.1%}"
            )

    return insights[:5]  # cap at 5


# ---------------------------------------------------------------------------
# Top products
# ---------------------------------------------------------------------------

def compute_top_products(ltk_products: list, top_n: int = 20) -> list:
    """
    Returns top N products by commissions, with rank added.
    Filters out rows where product_name is None/empty.
    Adds 'rank' field (1-based).
    Returns sorted list descending by commissions.
    """
    filtered = [p for p in ltk_products if p.get('product_name')]
    sorted_products = sorted(filtered, key=lambda p: p.get('commissions', 0), reverse=True)
    result = []
    for i, p in enumerate(sorted_products[:top_n]):
        product = dict(p)
        product['rank'] = i + 1
        result.append(product)
    return result


# ---------------------------------------------------------------------------
# Summary builder
# ---------------------------------------------------------------------------

def _build_summary(
    ltk_posts_scored: list,
    ig_stories_scored: list,
    ig_reels_scored: list,
    ltk_brands: list,
) -> dict:
    """Compute top-level summary stats."""
    total_commissions = sum(p.get("commissions") or 0.0 for p in ltk_posts_scored)
    total_ltk_clicks  = sum(p.get("clicks") or 0 for p in ltk_posts_scored)
    total_story_views = sum(s.get("views") or 0 for s in ig_stories_scored)
    total_reel_views  = sum(r.get("views") or 0 for r in ig_reels_scored)

    # Top brand from ltk_brands (already aggregated by ingest)
    top_brand = None
    if ltk_brands:
        top_b = max(ltk_brands, key=lambda b: b.get("commissions") or 0.0)
        top_brand = top_b.get("advertiser_name")

    top_ltk  = max(ltk_posts_scored, key=lambda p: p.get("composite_score") or 0.0) \
               if ltk_posts_scored else None
    top_story = max(ig_stories_scored, key=lambda s: s.get("composite_score") or 0.0) \
                if ig_stories_scored else None
    top_reel  = max(ig_reels_scored, key=lambda r: r.get("composite_score") or 0.0) \
                if ig_reels_scored else None

    # Date range across all scored content
    all_dates = []
    for p in ltk_posts_scored:
        dt = _naive_dt(p.get("date_published"))
        if dt:
            all_dates.append(dt)
    for s in ig_stories_scored + ig_reels_scored:
        dt = _naive_dt(s.get("publish_time"))
        if dt:
            all_dates.append(dt)

    if all_dates:
        dmin = min(all_dates)
        dmax = max(all_dates)
        date_range = f"{dmin.strftime('%b %-d')} – {dmax.strftime('%b %-d, %Y')}"
    else:
        date_range = "Spring 2025"

    return {
        "total_commissions": round(total_commissions, 2),
        "total_ltk_clicks":  total_ltk_clicks,
        "total_story_views": total_story_views,
        "total_reel_views":  total_reel_views,
        "top_brand":         top_brand,
        "top_ltk_post":      top_ltk,
        "top_ig_story":      top_story,
        "top_ig_reel":       top_reel,
        "date_range":        date_range,
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_scoring(data: dict, attribution: dict, visual_results: dict, caption_results: dict) -> dict:
    """
    Main entry point. Scores everything and returns the full results dict.

    data: output of ingest.load_all_data()
    attribution: output of attribution module (may be empty dict)
    visual_results: output of visual_analysis module (may be empty dict)
    caption_results: output of caption_nlp module (may be empty dict)
    """
    # --- Filter LTK posts to Spring 2025 ---
    raw_ltk = data.get("ltk_posts", [])
    spring_ltk = [p for p in raw_ltk if _in_spring(_naive_dt(p.get("date_published")))]

    # --- Attach any visual/caption analysis ---
    # visual_results keyed by hero_image or share_url; attach if available
    if visual_results:
        analyzed = visual_results.get("analyzed_posts", {}) or {}
        for p in spring_ltk:
            key = p.get("share_url") or p.get("hero_image") or ""
            if key in analyzed:
                p["visual_analysis"] = analyzed[key].get("visual_analysis")

    if caption_results:
        cap_map = caption_results.get("caption_results", {}) or {}
        for p in spring_ltk:
            key = p.get("share_url") or ""
            if key in cap_map:
                p["caption_features"] = cap_map[key].get("features")

    # --- Filter IG data: use only Lifetime rows (one per story/reel) ---
    raw_stories = data.get("ig_stories", [])
    raw_reels   = data.get("ig_reels", [])

    spring_stories = [
        s for s in raw_stories
        if s.get("date_is_lifetime") and _in_spring(_naive_dt(s.get("publish_time")))
    ]
    spring_reels = [
        r for r in raw_reels
        if r.get("date_is_lifetime") and _in_spring(_naive_dt(r.get("publish_time")))
    ]

    # --- Score each content type ---
    ltk_posts_scored   = score_ltk_posts_batch(spring_ltk)
    ig_stories_scored  = score_ig_stories_batch(spring_stories)
    ig_reels_scored    = score_ig_reels_batch(spring_reels)

    # --- Theme performance ---
    theme_performance = compute_theme_performance(ltk_posts_scored)

    # --- Weekly performance ---
    weekly_performance = compute_weekly_performance(ltk_posts_scored, ig_stories_scored)

    # --- Insights ---
    insights = generate_insights(
        ltk_posts_scored, ig_stories_scored, attribution, theme_performance
    )

    # --- Summary ---
    ltk_brands = data.get("ltk_brands", [])
    summary = _build_summary(ltk_posts_scored, ig_stories_scored, ig_reels_scored, ltk_brands)

    return {
        "ltk_posts_scored":   ltk_posts_scored,
        "ig_stories_scored":  ig_stories_scored,
        "ig_reels_scored":    ig_reels_scored,
        "theme_performance":  theme_performance,
        "weekly_performance": weekly_performance,
        "insights":           insights,
        "summary":            summary,
        "top_products":       compute_top_products(data.get('ltk_products', [])),
    }
