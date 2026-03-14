"""
report_generator.py — Content Intelligence Report Generator

Combines all analysis module outputs into the DATA contract structure and
injects it into the HTML template to produce a self-contained report file.
"""

import json
import os
import re
from datetime import datetime, date, timedelta
from collections import defaultdict
from pathlib import Path

# Path to the HTML template (relative to this file)
_TEMPLATE_PATH = Path(__file__).parent.parent / "templates" / "report_template.html"


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────────────────────────────────────

def build_report_data(
    data: dict,
    attribution: dict,
    visual_results: dict,
    caption_results: dict,
) -> dict:
    """
    Combines all analysis outputs into the report DATA contract structure.

    Parameters
    ----------
    data : dict
        Raw source data. Expected keys:
            - ltk_posts:   list of LTK post dicts
            - ig_stories:  list of IG story dicts
            - ig_reels:    list of IG reel dicts
            - brands:      optional pre-aggregated brand list
            - meta:        optional metadata overrides

    attribution : dict
        Output from attribution module. Expected keys:
            - matches: list of match dicts {ltk_post, ig_story, match_type, confidence}
            - stats:   {total_attributed_commissions, attribution_rate, matched_url, matched_date}

    visual_results : dict
        Output from visual_analysis module. Expected keys:
            - theme_summary: {theme_name: {count, avg_commissions}}
            - per_post:      {post_id: {themes, dominant_colors, content_type, description}}

    caption_results : dict
        Output from caption_nlp module. Expected keys:
            - top_words:       [{word, count}]
            - top_captions:    [{text, commissions, clicks, date}]

    Returns
    -------
    dict — matches the DATA structure expected by report_template.html
    """

    ltk_posts  = data.get("ltk_posts", [])
    ig_stories = data.get("ig_stories", [])
    ig_reels   = data.get("ig_reels", [])

    # ── Attach visual analysis to each LTK post ──────────────────────────────
    per_post = visual_results.get("per_post", {})
    for post in ltk_posts:
        pid = post.get("id") or post.get("share_url") or ""
        if pid in per_post:
            post["visual_analysis"] = per_post[pid]

    # ── Summary stats ─────────────────────────────────────────────────────────
    total_commissions = sum(p.get("commissions", 0) for p in ltk_posts)
    total_clicks      = sum(p.get("clicks", 0)      for p in ltk_posts)
    total_story_views = sum(s.get("views", 0)        for s in ig_stories)
    total_reel_views  = sum(r.get("views", 0)        for r in ig_reels)

    # Top brand
    brand_totals: dict[str, float] = defaultdict(float)
    for post in ltk_posts:
        for brand in post.get("brands", []):
            brand_totals[brand] += post.get("commissions", 0)
    top_brand = max(brand_totals, key=brand_totals.get) if brand_totals else "—"

    # ── Brands aggregation ────────────────────────────────────────────────────
    if "brands" in data and data["brands"]:
        brands = data["brands"]
    else:
        brands = _aggregate_brands(ltk_posts)

    # ── Top products ──────────────────────────────────────────────────────────
    ltk_products = data.get('ltk_products', [])
    # Get top 20 products by commissions
    top_products_raw = sorted(
        [p for p in ltk_products if p.get('product_name') and p.get('commissions', 0) > 0],
        key=lambda p: p.get('commissions', 0),
        reverse=True
    )[:20]
    top_products = [
        {
            'rank': i + 1,
            'product_name': p.get('product_name', ''),
            'brand': p.get('advertiser_name', ''),
            'image': p.get('image', ''),
            'price': p.get('price', 0),
            'commissions': round(p.get('commissions', 0), 2),
            'clicks': p.get('clicks', 0),
            'orders': p.get('orders', 0),
            'items_sold': p.get('items_sold', 0),
            'conversion_rate': round(p.get('order_conversion_rate', 0), 4),
        }
        for i, p in enumerate(top_products_raw)
    ]

    # ── Weekly performance time series ────────────────────────────────────────
    weekly_performance = _build_weekly_performance(ltk_posts, ig_stories)

    # ── Themes ───────────────────────────────────────────────────────────────
    themes = visual_results.get("theme_summary", {})
    if not themes:
        themes = _derive_themes_from_posts(ltk_posts)

    # ── Insights ─────────────────────────────────────────────────────────────
    insights = _generate_insights(
        ltk_posts, ig_stories, themes, attribution,
        caption_results.get("top_words", [])
    )

    # ── Meta ──────────────────────────────────────────────────────────────────
    meta = {
        "creator":      data.get("meta", {}).get("creator", "Nicki Entenmann"),
        "date_range":   data.get("meta", {}).get("date_range", "March 1 – May 31, 2025"),
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }

    # ── Caption NLP — wire in all computed keys ───────────────────────────────
    # Note: run_caption_analysis() returns "word_frequency" not "top_words".
    # We read both spellings so this works whether caption_results came from
    # run_caption_analysis() (key="word_frequency") or from legacy callers
    # that manually built a dict with key="top_words".
    top_caption_words = (
        caption_results.get("word_frequency")
        or caption_results.get("top_words")
        or []
    )

    # Virality signal aggregation: count each signal across all IG posts
    virality_signal_counter: dict[str, int] = defaultdict(int)
    for item in (
        caption_results.get("ig_stories", [])
        + caption_results.get("ig_reels", [])
    ):
        for signal in item.get("virality_signals") or []:
            virality_signal_counter[signal] += 1
    virality_signal_distribution = [
        {"signal": sig, "count": cnt}
        for sig, cnt in sorted(
            virality_signal_counter.items(), key=lambda x: x[1], reverse=True
        )
    ]

    return {
        "meta":               meta,
        "summary": {
            "total_commissions": round(total_commissions, 2),
            "total_ltk_clicks":  total_clicks,
            "top_brand":         top_brand,
            "total_story_views": total_story_views,
            "total_reel_views":  total_reel_views,
        },
        "brands":             brands,
        "ltk_posts":          ltk_posts,
        "ig_stories":         ig_stories,
        "ig_reels":           ig_reels,
        "attribution":        attribution,
        "themes":             themes,
        "weekly_performance": weekly_performance,
        "insights":           insights,
        "top_products":       top_products,
        # ── Caption NLP ───────────────────────────────────────────────────────
        "top_caption_words":          top_caption_words,
        "top_meaningful_words":       caption_results.get("top_meaningful_words", []),
        "high_performing_captions":   caption_results.get("high_performing_captions", []),
        "engagement_by_intent":       caption_results.get("engagement_by_intent", {}),
        "caption_length_performance": caption_results.get("caption_length_performance", {}),
        "hook_type_distribution":     caption_results.get("hook_type_distribution", {}),
        "intent_distribution":        caption_results.get("intent_distribution", {}),
        "seasonal_distribution":      caption_results.get("seasonal_distribution", {}),
        "product_category_distribution": caption_results.get("product_category_distribution", {}),
        "top_promo_codes":            caption_results.get("top_promo_codes", []),
        "top_brand_mentions":         caption_results.get("top_brand_mentions", []),
        "caption_stats":              caption_results.get("stats", {}),
        "virality_signal_distribution": virality_signal_distribution,
    }


def generate_report(report_data: dict, output_path: str) -> str:
    """
    Reads the HTML template, injects report_data as JSON, writes to output_path.

    Parameters
    ----------
    report_data : dict  — the result of build_report_data()
    output_path : str   — absolute or relative path for the output HTML file

    Returns
    -------
    str — absolute path to the written file
    """
    template_path = _TEMPLATE_PATH
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")

    template_html = template_path.read_text(encoding="utf-8")

    # Serialize to JSON (compact but readable)
    json_str = json.dumps(report_data, ensure_ascii=False, default=_json_default)

    # Inject — replace placeholder
    output_html = template_html.replace("{{DATA_JSON}}", json_str)

    # Also replace the title creator name placeholder
    creator = report_data.get("meta", {}).get("creator", "Creator")
    output_html = output_html.replace("{{CREATOR_NAME}}", creator)

    # Write file
    out = Path(output_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(output_html, encoding="utf-8")

    return str(out)


def generate_sample_report(output_path=None) -> str:
    """
    Generates a report populated with realistic mock data for visual testing.
    No real CSV files or API calls required.

    Parameters
    ----------
    output_path : optional str — where to write the HTML.
                  Defaults to output/sample_report.html next to this module.

    Returns
    -------
    str — absolute path to the written file
    """
    if output_path is None:
        output_path = str(
            Path(__file__).parent.parent / "output" / "sample_report.html"
        )

    report_data = _build_mock_data()
    return generate_report(report_data, output_path)


# ─────────────────────────────────────────────────────────────────────────────
# PRIVATE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _json_default(obj):
    """JSON serializer for non-serializable types (date, datetime)."""
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def _aggregate_brands(ltk_posts: list) -> list:
    """Aggregate brand-level stats from LTK posts."""
    brand_map: dict[str, dict] = defaultdict(lambda: {"commissions": 0, "clicks": 0, "orders": 0})
    for post in ltk_posts:
        for brand in post.get("brands", []):
            brand_map[brand]["commissions"] += post.get("commissions", 0)
            brand_map[brand]["clicks"]      += post.get("clicks", 0)
            brand_map[brand]["orders"]      += post.get("orders", 0)

    return [
        {
            "name":        name,
            "commissions": round(v["commissions"], 2),
            "clicks":      v["clicks"],
            "orders":      v["orders"],
        }
        for name, v in brand_map.items()
    ]


def _build_weekly_performance(ltk_posts: list, ig_stories: list) -> list:
    """
    Builds a weekly time-series combining LTK and IG story metrics.
    Each week bucket aligns to Monday of that week.
    """
    week_data: dict[str, dict] = defaultdict(lambda: {
        "commissions": 0.0,
        "clicks":      0,
        "story_views": 0,
    })

    def _week_start(date_str: str) -> str:
        """Return ISO date string for the Monday of the week containing date_str."""
        try:
            d = datetime.fromisoformat(date_str.split("T")[0])
            monday = d - timedelta(days=d.weekday())
            return monday.strftime("%Y-%m-%d")
        except Exception:
            return date_str[:10] if date_str else ""

    for post in ltk_posts:
        ds = post.get("date_published") or post.get("date") or ""
        if not ds:
            continue
        wk = _week_start(ds)
        week_data[wk]["commissions"] += post.get("commissions", 0)
        week_data[wk]["clicks"]      += post.get("clicks", 0)

    for story in ig_stories:
        ds = story.get("date") or story.get("timestamp") or ""
        if not ds:
            continue
        wk = _week_start(ds)
        week_data[wk]["story_views"] += story.get("views", 0)

    return [
        {
            "week":        wk,
            "commissions": round(v["commissions"], 2),
            "clicks":      v["clicks"],
            "story_views": v["story_views"],
        }
        for wk, v in sorted(week_data.items())
    ]


def _derive_themes_from_posts(ltk_posts: list) -> dict:
    """
    Derives a theme summary from visual_analysis data embedded in LTK posts.
    Falls back to empty dict if no visual analysis present.
    """
    theme_map: dict[str, dict] = defaultdict(lambda: {"count": 0, "total_commissions": 0.0})
    for post in ltk_posts:
        va = post.get("visual_analysis") or {}
        for theme in va.get("themes", []):
            theme_map[theme]["count"]             += 1
            theme_map[theme]["total_commissions"] += post.get("commissions", 0)

    return {
        name: {
            "count":           v["count"],
            "avg_commissions": round(v["total_commissions"] / v["count"], 2) if v["count"] else 0,
        }
        for name, v in theme_map.items()
    }


def _generate_insights(
    ltk_posts: list,
    ig_stories: list,
    themes: dict,
    attribution: dict,
    top_words: list,
) -> list[str]:
    """Generates up to 3 data-driven insight strings."""
    insights = []

    # Insight 1: top theme vs average
    if themes:
        avg_all = (
            sum(v["avg_commissions"] for v in themes.values()) / len(themes)
        ) if themes else 0
        best_theme, best_v = max(themes.items(), key=lambda x: x[1]["avg_commissions"])
        mult = best_v["avg_commissions"] / avg_all if avg_all else 1
        insights.append(
            f"'{best_theme.capitalize()}' posts generated {mult:.1f}x more revenue than average "
            f"(${best_v['avg_commissions']:,.0f}/post vs ${avg_all:,.0f} avg)"
        )

    # Insight 2: attribution rate
    attr_stats = attribution.get("stats", {})
    attr_rate = attr_stats.get("attribution_rate", 0)
    attr_comm = attr_stats.get("total_attributed_commissions", 0)
    if attr_rate:
        insights.append(
            f"{int(attr_rate * 100)}% of commissions (${attr_comm:,.0f}) were directly attributed "
            f"to Instagram story or reel promotions"
        )

    # Insight 3: top word in high-performing captions
    if top_words:
        top_word = top_words[0]["word"] if top_words else ""
        top_count = top_words[0]["count"] if top_words else 0
        if top_word:
            insights.append(
                f"The word '{top_word}' appeared {top_count}x in high-performing captions — "
                f"sales-intent language consistently drives higher click-through"
            )

    # Fallback
    if not insights:
        insights = [
            "No theme data available — run visual analysis to unlock content insights.",
            "Attribution matching requires both LTK and IG story data exports.",
            "Caption NLP requires post caption text to be included in your data export.",
        ]

    return insights[:3]


# ─────────────────────────────────────────────────────────────────────────────
# MOCK DATA (for visual testing)
# ─────────────────────────────────────────────────────────────────────────────

def _build_mock_data() -> dict:
    """
    Returns a complete mock DATA dict that exercises every section of the
    HTML template. All numbers are plausible for a mid-tier fashion creator.
    """
    import random
    random.seed(42)

    BRANDS = [
        ("Abercrombie", 3180, 5200, 127),
        ("Lululemon",   2450, 3800,  98),
        ("Free People", 1820, 2900,  72),
        ("ASOS",        1210, 4100,  85),
        ("Revolve",     1180, 2100,  53),
        ("Nordstrom",    980, 1800,  44),
        ("H&M",          750, 3200,  90),
        ("Mango",        620, 1500,  38),
        ("Zara",         590, 1300,  32),
        ("Urban Outfitters", 480, 1100, 27),
        ("Anthropologie",    420, 900,  21),
        ("SHEIN",            310, 2800,  68),
        ("J.Crew",           280, 600,  14),
        ("Gap",              210, 900,  22),
        ("Express",          170, 500,  12),
    ]

    THEMES = {
        "swimwear":   {"count": 48, "avg_commissions": 312},
        "athleisure": {"count": 35, "avg_commissions": 195},
        "casual":     {"count": 62, "avg_commissions": 148},
        "going_out":  {"count": 29, "avg_commissions": 220},
        "resort_wear":{"count": 22, "avg_commissions": 280},
        "outerwear":  {"count": 18, "avg_commissions": 175},
        "denim":      {"count": 41, "avg_commissions": 165},
        "matching_sets": {"count": 25, "avg_commissions": 240},
        "accessories": {"count": 15, "avg_commissions": 120},
    }

    CAPTION_WORDS = [
        {"word": "sale",       "count": 85},
        {"word": "code",       "count": 78},
        {"word": "linked",     "count": 74},
        {"word": "obsessed",   "count": 67},
        {"word": "wearing",    "count": 63},
        {"word": "shop",       "count": 60},
        {"word": "spring",     "count": 55},
        {"word": "new",        "count": 52},
        {"word": "favorites",  "count": 48},
        {"word": "off",        "count": 45},
        {"word": "discount",   "count": 41},
        {"word": "use",        "count": 39},
        {"word": "swimsuit",   "count": 36},
        {"word": "linking",    "count": 34},
        {"word": "love",       "count": 31},
    ]

    # Generate LTK posts
    ltk_posts = []
    base_date = date(2025, 3, 1)
    for i in range(80):
        post_date = base_date + timedelta(days=random.randint(0, 91))
        commissions = round(random.uniform(20, 950) * (2 if random.random() > 0.85 else 1), 2)
        clicks = int(commissions * random.uniform(5, 15))
        orders = int(commissions / random.uniform(8, 18))
        theme_list = random.sample(list(THEMES.keys()), k=random.randint(1, 2))
        brand_list = random.sample([b[0] for b in BRANDS], k=random.randint(1, 3))
        caption_samples = [
            f"Obsessed with this new {theme_list[0]} look! Use code NICKI for 20% off — linked in bio 🛍️",
            f"Spring sale alert! Just linked everything I'm wearing today. Shop via my LTK ✨",
            f"This {theme_list[0]} set is giving everything. Sizes run small, size up! Linked 💛",
            f"My go-to for {theme_list[0]} this season. Sale ends tonight — use my code for extra off!",
        ]
        ltk_posts.append({
            "id":             f"ltk_{i:04d}",
            "hero_image":     None,
            "date_published": post_date.isoformat(),
            "clicks":         clicks,
            "commissions":    commissions,
            "orders":         orders,
            "items_sold":     orders * random.randint(1, 4),
            "share_url":      f"https://liketk.it/{i:04x}",
            "brands":         brand_list,
            "caption":        random.choice(caption_samples),
            "visual_analysis": {
                "themes":           theme_list,
                "dominant_colors":  random.sample(["white","beige","black","blue","green","pink"], 2),
                "content_type":     random.choice(["outfit_photo","flat_lay","try_on_haul","lifestyle"]),
                "description":      f"Creator wearing {theme_list[0]} in a bright, airy setting.",
            },
            "attributed_ig_post": None,
        })

    # Generate IG stories
    ig_stories = []
    for i in range(120):
        story_date = base_date + timedelta(days=random.randint(0, 91))
        ig_stories.append({
            "id":          f"story_{i:04d}",
            "date":        story_date.isoformat(),
            "views":       random.randint(4000, 25000),
            "link_clicks": random.randint(50, 800),
            "reach":       random.randint(3000, 20000),
        })

    # Generate IG reels
    reel_captions = [
        "Get ready with me — spring haul from Abercrombie 🌸",
        "5 outfits under $50 — linked everything!",
        "My honest review of Lululemon's new collection",
        "Spring break swimwear try-on haul 👙",
        "GRWM for Easter brunch — pastel vibes only",
        "Workout fits I'm loving this season",
        "Day in my life + what I wore",
        "Unboxing my Free People order!",
        "Styling the same dress 4 ways",
        "What I'm wearing to the music festival",
    ]
    ig_reels = []
    for i in range(10):
        reel_date = base_date + timedelta(days=random.randint(0, 91))
        views = random.randint(30000, 400000)
        ig_reels.append({
            "id":       f"reel_{i:04d}",
            "date":     reel_date.isoformat(),
            "caption":  reel_captions[i],
            "views":    views,
            "likes":    int(views * random.uniform(0.03, 0.12)),
            "shares":   int(views * random.uniform(0.005, 0.03)),
            "saves":    int(views * random.uniform(0.01, 0.05)),
            "comments": int(views * random.uniform(0.002, 0.01)),
        })

    # Attribution matches
    matches = []
    for i in range(55):
        ltk_post = ltk_posts[i % len(ltk_posts)]
        ig_story  = ig_stories[i % len(ig_stories)]
        match_type = "url" if i < 15 else "date"
        confidence = round(random.uniform(0.6, 0.98) if match_type == "url" else random.uniform(0.4, 0.75), 2)
        matches.append({
            "ltk_post":   ltk_post,
            "ig_story":   ig_story,
            "match_type": match_type,
            "confidence": confidence,
        })

    total_commissions = sum(p["commissions"] for p in ltk_posts)
    attr_commissions  = sum(
        m["ltk_post"]["commissions"] for m in matches
    )

    # Weekly performance
    weekly: dict[str, dict] = defaultdict(lambda: {"commissions": 0.0, "clicks": 0, "story_views": 0})
    for post in ltk_posts:
        d = date.fromisoformat(post["date_published"])
        monday = d - timedelta(days=d.weekday())
        wk = monday.isoformat()
        weekly[wk]["commissions"] += post["commissions"]
        weekly[wk]["clicks"]      += post["clicks"]
    for story in ig_stories:
        d = date.fromisoformat(story["date"])
        monday = d - timedelta(days=d.weekday())
        wk = monday.isoformat()
        weekly[wk]["story_views"] += story["views"]
    weekly_list = [
        {"week": wk, "commissions": round(v["commissions"], 2), "clicks": v["clicks"], "story_views": v["story_views"]}
        for wk, v in sorted(weekly.items())
    ]

    return {
        "meta": {
            "creator":      "Nicki Entenmann",
            "date_range":   "March 1 – May 31, 2025",
            "generated_at": datetime.utcnow().isoformat() + "Z",
        },
        "summary": {
            "total_commissions": round(total_commissions, 2),
            "total_ltk_clicks":  sum(p["clicks"] for p in ltk_posts),
            "top_brand":         "Abercrombie",
            "total_story_views": sum(s["views"] for s in ig_stories),
            "total_reel_views":  sum(r["views"] for r in ig_reels),
        },
        "brands": [
            {"name": b[0], "commissions": b[1], "clicks": b[2], "orders": b[3]}
            for b in BRANDS
        ],
        "ltk_posts":  ltk_posts,
        "ig_stories": ig_stories,
        "ig_reels":   ig_reels,
        "attribution": {
            "matches": matches,
            "stats": {
                "total_attributed_commissions": round(attr_commissions, 2),
                "attribution_rate":             round(attr_commissions / total_commissions, 3) if total_commissions else 0,
                "matched_url":                  15,
                "matched_date":                 40,
            },
        },
        "themes": THEMES,
        "weekly_performance": weekly_list,
        "insights": [
            f"Swimwear posts generated 1.6x more revenue than average (${THEMES['swimwear']['avg_commissions']:,}/post vs $195 avg) — prioritize swimwear content in June.",
            f"{int(round(attr_commissions / total_commissions, 2) * 100)}% of commissions (${int(attr_commissions):,}) were directly attributed to Instagram story promotions — stories are the primary revenue driver.",
            "The word 'sale' appeared 85x in top-performing captions — urgency and discount language consistently drives higher click-through rates.",
        ],
        # ── Caption NLP mock data ─────────────────────────────────────────────
        "top_caption_words": CAPTION_WORDS,
        "top_meaningful_words": CAPTION_WORDS[:10],
        "high_performing_captions": [
            {"caption": "Spring sale alert! Linked everything I'm wearing — shop via my LTK ✨", "platform": "ig_reel",  "views": 382000, "intent": "sale_promotion",   "hook_type": "discount"},
            {"caption": "Obsessed with this swimwear look! Use code NICKI for 20% off 🛍️",      "platform": "ig_story", "views": 241000, "intent": "product_showcase", "hook_type": "discount"},
            {"caption": "Get ready with me — spring haul from Abercrombie 🌸",                  "platform": "ig_reel",  "views": 198000, "intent": "lifestyle",         "hook_type": "aspiration"},
            {"caption": "5 outfits under $50 — linked everything!",                             "platform": "ig_reel",  "views": 175000, "intent": "educational",       "hook_type": "education"},
            {"caption": "This matching set is giving everything. Sale ends tonight!",            "platform": "ig_story", "views": 162000, "intent": "sale_promotion",   "hook_type": "discount"},
        ],
        "engagement_by_intent": {
            "sale_promotion":   {"avg_views": 18400, "avg_link_clicks": 420, "count": 38},
            "product_showcase": {"avg_views": 14200, "avg_link_clicks": 310, "count": 45},
            "call_to_action":   {"avg_views": 16800, "avg_link_clicks": 390, "count": 22},
            "lifestyle":        {"avg_views": 11500, "avg_link_clicks": 185, "count": 29},
            "personal_story":   {"avg_views":  9800, "avg_link_clicks": 120, "count": 14},
            "entertainment":    {"avg_views": 13200, "avg_link_clicks": 210, "count": 18},
        },
        "caption_length_performance": {
            "short":  {"avg_views": 12400, "count": 48},
            "medium": {"avg_views": 16900, "count": 72},
            "long":   {"avg_views": 14100, "count": 30},
        },
        "hook_type_distribution": {
            "discount":       42,
            "aspiration":     28,
            "product_reveal": 21,
            "education":      14,
            "trend":          12,
            "personal_story":  9,
            "relatable_humor": 7,
            "challenge":       3,
        },
        "intent_distribution": {
            "sale_promotion":   38,
            "product_showcase": 45,
            "call_to_action":   22,
            "lifestyle":        29,
            "personal_story":   14,
            "entertainment":    18,
            "educational":      11,
            "trend_moment":      8,
        },
        "seasonal_distribution": {
            "spring":       65,
            "easter":       18,
            "memorial_day": 12,
            "summer_preview": 20,
            "generic":      34,
        },
        "product_category_distribution": {
            "fashion":   95,
            "fitness":   18,
            "beauty":    12,
            "lifestyle":  8,
            "other":      5,
        },
        "top_promo_codes": [
            {"code": "NICKI",    "count": 38},
            {"code": "NICKI20",  "count": 22},
            {"code": "SPRING15", "count": 14},
            {"code": "SAVE10",   "count":  9},
        ],
        "top_brand_mentions": [
            {"brand": "abercrombie",    "count": 28},
            {"brand": "lululemon",      "count": 22},
            {"brand": "freepeople",     "count": 16},
            {"brand": "revolve",        "count": 12},
            {"brand": "nordstrom",      "count":  9},
        ],
        "caption_stats": {
            "avg_caption_length_stories": 18.4,
            "avg_caption_length_reels":   32.7,
            "pct_with_cta":               68.2,
            "pct_with_discount_code":     44.5,
            "total_analyzed":             150,
        },
        "virality_signal_distribution": [
            {"signal": "relatable",   "count": 52},
            {"signal": "inspiring",   "count": 38},
            {"signal": "informative", "count": 29},
            {"signal": "satisfying",  "count": 21},
            {"signal": "funny",       "count": 14},
            {"signal": "controversial", "count": 3},
        ],
        # ── Top Performers (from scoring module) ─────────────────────────────
        "top_ltk_post": {
            "hero_image":    None,
            "share_url":     "https://liketk.it/sample",
            "date_published": "2025-04-12",
            "commissions":   847.50,
            "clicks":        9200,
            "orders":        58,
            "composite_score": 97.4,
            "tier":          "hero",
            "caption":       "Spring sale alert! Linked everything I'm wearing — shop via my LTK ✨",
            "visual_analysis": {
                "themes": ["swimwear"],
                "content_type": "outfit_photo",
                "description": "Bright poolside swimwear look in coral tones.",
            },
        },
        "top_ig_story": {
            "id":            "story_0042",
            "publish_time":  "2025-04-12T14:00:00",
            "views":         24800,
            "link_clicks":   742,
            "reach":         21000,
            "likes":         380,
            "replies":       94,
            "follows":       28,
            "composite_score": 96.1,
            "tier":          "viral",
            "description":   "LTK spring sale haul — swipe up for all links",
        },
        "top_ig_reel": {
            "id":            "reel_0003",
            "publish_time":  "2025-04-05T11:00:00",
            "views":         382000,
            "likes":         38200,
            "comments":      1910,
            "saves":         14820,
            "shares":        7640,
            "composite_score": 98.2,
            "tier":          "viral",
            "caption":       "Spring break swimwear try-on haul 👙",
        },
        "date_range": "Mar 1 – May 31, 2025",
    }
