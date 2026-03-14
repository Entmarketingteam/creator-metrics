# Caption Intelligence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add IG SEO scoring to the caption NLP engine, update composite scoring formulas, overhaul the HTML report Section 7 with 7 panels, and ship a live `/dashboard/intelligence/captions` Vercel page as a 4th Intelligence tab.

**Architecture:** Python pipeline changes are pure-Python SEO scoring + ThreadPoolExecutor parallelism layered on top of the existing `caption_nlp.py` / `scoring.py` modules. Vercel side adds a `caption_analysis` Drizzle table, nightly cron + on-demand API route via agent server proxy, and a server-component page with 4 client components.

**Tech Stack:** Python 3, ThreadPoolExecutor, Claude CLI subprocess (Max subscription), Drizzle ORM + Supabase/PostgreSQL, Next.js 14 App Router, TypeScript, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-03-14-caption-intelligence-design.md`

---

## Chunk 1: Python NLP — SEO scoring + parallelism

### Task 1: Add `calculate_seo_score()` to caption_nlp.py

**Files:**
- Modify: `scripts/content-intelligence/modules/caption_nlp.py`
- Create: `scripts/content-intelligence/tests/test_seo_score.py`

- [ ] **Step 1: Write the failing tests**

Create `scripts/content-intelligence/tests/__init__.py` (empty) and `scripts/content-intelligence/tests/test_seo_score.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from modules.caption_nlp import calculate_seo_score

def test_returns_dict_with_score_and_breakdown():
    result = calculate_seo_score("Love this spring dress! Shop the link in bio. #fashion", {})
    assert "seo_score" in result
    assert "seo_breakdown" in result
    assert "hook_text" in result
    assert "hook_quality_label" in result
    assert "hashtag_quality" in result
    assert "cta_type" in result
    assert 0 <= result["seo_score"] <= 100

def test_strong_hook_scores_high():
    caption = "Spring fashion haul: outfit ideas for warm weather dresses and linen sets. " \
              "Save this post! #spring #fashion"
    result = calculate_seo_score(caption, {})
    assert result["hook_quality_label"] == "strong"
    assert result["seo_breakdown"]["hook_quality"] >= 16

def test_over_limit_hashtags_score_zero():
    caption = "Cute look! #a #b #c #d #e #f #g"
    result = calculate_seo_score(caption, {})
    assert result["hashtag_quality"] == "over_limit"
    assert result["seo_breakdown"]["hashtag_efficiency"] == 0

def test_optimal_hashtags():
    caption = "Outfit inspo for spring. #fashion #ootd"
    result = calculate_seo_score(caption, {})
    assert result["hashtag_quality"] == "optimal"
    assert result["seo_breakdown"]["hashtag_efficiency"] == 15

def test_no_hashtags_half_score():
    caption = "Cute summer dress find, link in bio to shop!"
    result = calculate_seo_score(caption, {})
    assert result["hashtag_quality"] == "none"
    assert result["seo_breakdown"]["hashtag_efficiency"] == 7

def test_dm_cta_scores_full():
    caption = "DM me for the link or comment 'shop' and I'll send it!"
    result = calculate_seo_score(caption, {})
    assert result["cta_type"] == "dm"
    assert result["seo_breakdown"]["cta_quality"] == 15

def test_link_bio_cta():
    caption = "shop the link in my bio for this dress"
    result = calculate_seo_score(caption, {})
    assert result["cta_type"] == "link_bio"
    assert result["seo_breakdown"]["cta_quality"] == 8

def test_no_cta():
    caption = "loving spring vibes right now"
    result = calculate_seo_score(caption, {})
    assert result["cta_type"] == "none"
    assert result["seo_breakdown"]["cta_quality"] == 0

def test_empty_caption():
    result = calculate_seo_score("", {})
    assert result["seo_score"] == 0
    assert result["hook_quality_label"] == "weak"

def test_hook_text_is_first_125_chars():
    caption = "A" * 200
    result = calculate_seo_score(caption, {})
    assert result["hook_text"] == "A" * 125

def test_score_is_sum_of_breakdown():
    caption = "Spring fashion haul: best linen dresses and sandals this season! " \
              "DM me for the link! #fashion #spring @anthropologie @nordstrom"
    result = calculate_seo_score(caption, {})
    assert result["seo_score"] == sum(result["seo_breakdown"].values())
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/ethanatchley/creator-metrics/scripts/content-intelligence
python -m pytest tests/test_seo_score.py -v 2>&1 | head -30
```
Expected: `ImportError: cannot import name 'calculate_seo_score'`

- [ ] **Step 3: Implement `calculate_seo_score()` in caption_nlp.py**

Add after the `STOP_WORDS`/constants block and before `_extract_promo_codes`, at approximately line 99:

```python
# ---------------------------------------------------------------------------
# SEO scoring (IG July 2025 Google indexing update)
# ---------------------------------------------------------------------------

_RE_DM_CTA = re.compile(
    r"\b(dm\s+me|dm\s+for|comment\s+.{1,20}\s+and\s+i|reply\s+.{0,10}\s+for|"
    r"send\s+me\s+a\s+dm|message\s+me)\b",
    re.IGNORECASE,
)
_RE_LINK_BIO_CTA = re.compile(
    r"\b(link\s+in\s+(my\s+)?bio|shop\s+(the\s+)?link|click\s+link|tap\s+link|"
    r"swipe\s+up|link\s+in\s+profile)\b",
    re.IGNORECASE,
)
_RE_ENGAGEMENT_MECHANIC = re.compile(
    r"\?|save\s+this|drop\s+a|comment\s+(below|your)|tag\s+(a\s+friend|someone)|"
    r"which\s+(one|do\s+you)",
    re.IGNORECASE,
)
_NICHE_KEYWORDS = {
    "fashion", "outfit", "style", "ootd", "lookbook", "wardrobe", "trend",
    "spring", "summer", "fall", "winter", "season", "collection", "new",
    "dress", "jeans", "denim", "linen", "athleisure", "activewear", "swimwear",
    "sneakers", "sandals", "heels", "boots", "bag", "accessories", "jewelry",
    "haul", "finds", "picks", "faves", "favorites", "obsessed", "must-have",
    "affordable", "budget", "luxury", "sale", "discount", "code",
    "workout", "fitness", "gym", "pilates", "yoga", "running",
    "beauty", "skincare", "makeup", "hair", "wellness", "lifestyle",
    "home", "decor", "travel", "food", "recipe",
}


def calculate_seo_score(caption: str, features: dict) -> dict:
    """
    Score a caption on 7 IG SEO dimensions (0-100 total).

    Dimensions and max points:
    - hook_quality:        20 pts — first 125 chars keyword/structure quality
    - keyword_relevance:   25 pts — niche vocabulary in caption body
    - hashtag_efficiency:  15 pts — 1-5 = full, 0 = half, >5 = zero
    - cta_quality:         15 pts — DM CTA > link-in-bio > none
    - brand_mentions:      10 pts — @mentions or brand names present
    - alt_text_flag:       10 pts — caption describes visual content
    - engagement_mechanics: 5 pts — question, save prompt, tag-a-friend

    Returns dict with seo_score, seo_breakdown, hook_text,
    hook_quality_label, hashtag_quality, cta_type.
    """
    if not caption:
        return {
            "seo_score": 0,
            "seo_breakdown": {
                "hook_quality": 0, "keyword_relevance": 0,
                "hashtag_efficiency": 0, "cta_quality": 0,
                "brand_mentions": 0, "alt_text_flag": 0,
                "engagement_mechanics": 0,
            },
            "hook_text": "",
            "hook_quality_label": "weak",
            "hashtag_quality": "none",
            "cta_type": "none",
        }

    # ── Hook quality (first 125 chars) ────────────────────────────────
    hook_text = caption[:125]
    hook_words = [w.lower().strip(".,!?#@") for w in hook_text.split() if len(w) > 2]
    niche_hits_hook = sum(1 for w in hook_words if w in _NICHE_KEYWORDS)

    # Structure: starts with noun/keyword (not "I ", "So ", "Just ")
    weak_starters = re.compile(r"^(i |so |just |omg |ok |hey |hi )", re.IGNORECASE)
    has_weak_start = bool(weak_starters.match(hook_text))

    hook_pts = 0
    if niche_hits_hook >= 3:
        hook_pts += 12
    elif niche_hits_hook >= 1:
        hook_pts += 7
    if not has_weak_start and len(hook_text.split()) >= 5:
        hook_pts += 5
    if any(c.isupper() for c in hook_text[:30]):
        hook_pts += 3  # capitalization signals
    hook_pts = min(hook_pts, 20)

    if hook_pts >= 16:
        hook_quality_label = "strong"
    elif hook_pts >= 10:
        hook_quality_label = "moderate"
    else:
        hook_quality_label = "weak"

    # ── Keyword relevance (full caption) ──────────────────────────────
    caption_words = [w.lower().strip(".,!?#@") for w in caption.split() if len(w) > 2]
    niche_hits_body = sum(1 for w in caption_words if w in _NICHE_KEYWORDS)
    if niche_hits_body >= 5:
        kw_pts = 25
    elif niche_hits_body >= 3:
        kw_pts = 18
    elif niche_hits_body >= 1:
        kw_pts = 10
    else:
        kw_pts = 0

    # ── Hashtag efficiency ────────────────────────────────────────────
    # Use pre-extracted feature if available, else count from caption
    hashtag_count = features.get("hashtag_count") if features else None
    if hashtag_count is None:
        hashtag_count = len(_RE_HASHTAG.findall(caption))

    if hashtag_count == 0:
        hashtag_pts = 7   # no hashtags = half score
        hashtag_quality = "none"
    elif 1 <= hashtag_count <= 5:
        hashtag_pts = 15  # optimal
        hashtag_quality = "optimal"
    else:
        hashtag_pts = 0   # over limit, algorithmically suppressed
        hashtag_quality = "over_limit"

    # ── CTA quality ───────────────────────────────────────────────────
    if _RE_DM_CTA.search(caption):
        cta_pts = 15
        cta_type = "dm"
    elif _RE_LINK_BIO_CTA.search(caption):
        cta_pts = 8
        cta_type = "link_bio"
    else:
        # Generic "shop" / "click" / "tap" without bio context
        generic_cta = re.compile(r"\b(shop|buy|click|tap|get)\b", re.IGNORECASE)
        if generic_cta.search(caption):
            cta_pts = 4
            cta_type = "link_bio"
        else:
            cta_pts = 0
            cta_type = "none"

    # ── Brand mentions ────────────────────────────────────────────────
    mention_count = features.get("mention_count") if features else None
    if mention_count is None:
        mention_count = len(_RE_MENTION.findall(caption))
    brand_pts = min(mention_count * 4, 10)

    # ── Alt text flag (caption describes visual) ──────────────────────
    visual_words = re.compile(
        r"\b(wearing|styled|outfit|look|dressed|showing|featuring|"
        r"pictured|seen here|left to right|this is)\b",
        re.IGNORECASE,
    )
    alt_pts = 10 if visual_words.search(caption) else 0

    # ── Engagement mechanics ──────────────────────────────────────────
    eng_mech_pts = 5 if _RE_ENGAGEMENT_MECHANIC.search(caption) else 0

    breakdown = {
        "hook_quality":         hook_pts,
        "keyword_relevance":    kw_pts,
        "hashtag_efficiency":   hashtag_pts,
        "cta_quality":          cta_pts,
        "brand_mentions":       brand_pts,
        "alt_text_flag":        alt_pts,
        "engagement_mechanics": eng_mech_pts,
    }
    total = sum(breakdown.values())

    return {
        "seo_score":          total,
        "seo_breakdown":      breakdown,
        "hook_text":          hook_text,
        "hook_quality_label": hook_quality_label,
        "hashtag_quality":    hashtag_quality,
        "cta_type":           cta_type,
    }
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/ethanatchley/creator-metrics/scripts/content-intelligence
python -m pytest tests/test_seo_score.py -v
```
Expected: All 12 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/ethanatchley/creator-metrics
git add scripts/content-intelligence/modules/caption_nlp.py \
        scripts/content-intelligence/tests/__init__.py \
        scripts/content-intelligence/tests/test_seo_score.py
git commit -m "feat(nlp): add calculate_seo_score() — 7-dimension IG SEO scoring"
```

---

### Task 2: Add SEO fields to `run_caption_analysis()` + parallelize `classify_caption_batch()`

**Files:**
- Modify: `scripts/content-intelligence/modules/caption_nlp.py`
- Modify: `scripts/content-intelligence/tests/test_seo_score.py`

- [ ] **Step 1: Write failing tests for new aggregate stats and per-post SEO fields**

Append to `tests/test_seo_score.py`:

```python
from modules.caption_nlp import run_caption_analysis

def _make_story(caption, views=100, reach=80, likes=5, replies=1, follows=0,
                link_clicks=2, sticker_taps=0):
    return {
        "description": caption, "views": views, "reach": reach, "likes": likes,
        "replies": replies, "follows": follows, "link_clicks": link_clicks,
        "sticker_taps": sticker_taps, "date_is_lifetime": True,
        "publish_time": None,
    }

def test_run_caption_analysis_returns_seo_aggregates():
    data = {
        "ig_stories": [
            _make_story("Spring fashion haul: linen dresses and sandals! DM me for link. #spring"),
            _make_story("Cute look today #a #b #c #d #e #f #g"),  # over limit
            _make_story(""),  # empty
        ],
        "ig_reels": [],
        "ltk_posts": [],
    }
    result = run_caption_analysis(data)
    assert "avg_seo_score" in result
    assert "seo_score_distribution" in result
    assert "seo_top_issues" in result
    assert "seo_prescriptions" in result
    # Distribution buckets present
    for bucket in ("0-25", "26-50", "51-75", "76-100"):
        assert bucket in result["seo_score_distribution"]

def test_run_caption_analysis_per_post_seo_fields():
    data = {
        "ig_stories": [
            _make_story("Spring outfit inspo: linen set with sandals. DM for link! #fashion #ootd"),
        ],
        "ig_reels": [],
        "ltk_posts": [],
    }
    result = run_caption_analysis(data)
    story = result["ig_stories"][0]
    assert "seo_score" in story
    assert "seo_breakdown" in story
    assert "hook_text" in story
    assert "hook_quality_label" in story
    assert "hashtag_quality" in story
    assert "cta_type" in story
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/ethanatchley/creator-metrics/scripts/content-intelligence
python -m pytest tests/test_seo_score.py::test_run_caption_analysis_returns_seo_aggregates \
                  tests/test_seo_score.py::test_run_caption_analysis_per_post_seo_fields -v
```
Expected: FAIL — `avg_seo_score` not in result.

- [ ] **Step 3: Parallelize `classify_caption_batch()` and add SEO to `run_caption_analysis()`**

**3a — Parallelize `classify_caption_batch()`:**

Replace the function signature and body (lines 283–361) with:

```python
def _classify_single_batch(batch: list, batch_num: int, total_batches: int) -> list:
    """Worker function for a single classification batch (called from ThreadPoolExecutor)."""
    payload = [
        {"id": item["id"], "caption": (item.get("caption") or "")[:200]}
        for item in batch
    ]
    captions_json = json.dumps(payload, ensure_ascii=False)
    print(f"    Classifying batch {batch_num}/{total_batches} ({len(batch)} captions)...")

    prompt = (
        "You are analyzing Instagram creator content for a data analytics platform.\n"
        "Classify each caption and return structured data.\n\n"
        "For each caption, return a JSON object with:\n"
        '- id: (same as input)\n'
        '- intent: one of ["sale_promotion", "product_showcase", "lifestyle", "entertainment", "educational", "call_to_action", "personal_story", "trend_moment"]\n'
        '- seasonal_tag: one of ["st_patricks_day", "easter", "spring", "summer_preview", "memorial_day", "mothers_day", "generic"]\n'
        '- tone: one of ["casual", "excited", "informative", "humorous", "aspirational"]\n'
        '- key_topics: array of 2-4 specific topic strings (e.g. ["spring_fashion", "sale", "athleisure"])\n'
        '- product_category: one of ["fashion", "fitness", "home", "beauty", "food", "travel", "lifestyle", "kids", "other"]\n'
        '- hook_type: one of ["discount", "trend", "relatable_humor", "aspiration", "education", "challenge", "personal_story", "product_reveal"]\n'
        '- has_urgency: true or false\n'
        '- virality_signals: array of 0-3 elements from ["relatable", "funny", "inspiring", "informative", "controversial", "satisfying"]\n\n'
        f"Input captions:\n{captions_json}\n\n"
        "Return ONLY a valid JSON array, one object per caption, in the same order as input. No markdown, no explanation."
    )

    raw = _call_claude(prompt)
    classifications: list = []
    try:
        clean = raw.strip()
        if clean.startswith("```"):
            clean = re.sub(r"^```[a-z]*\n?", "", clean)
            clean = re.sub(r"\n?```$", "", clean)
        classifications = json.loads(clean)
        if not isinstance(classifications, list):
            classifications = []
    except (json.JSONDecodeError, ValueError):
        classifications = []

    class_by_id: dict = {}
    for c in classifications:
        if isinstance(c, dict) and "id" in c:
            class_by_id[str(c["id"])] = c

    results = []
    for item in batch:
        merged = dict(item)
        clf = class_by_id.get(str(item["id"]), {})
        merged["intent"]          = clf.get("intent") or None
        merged["seasonal_tag"]    = clf.get("seasonal_tag") or None
        merged["tone"]            = clf.get("tone") or None
        merged["key_topics"]      = clf.get("key_topics") or []
        merged["product_category"] = clf.get("product_category") or None
        merged["hook_type"]       = clf.get("hook_type") or None
        merged["has_urgency"]     = clf.get("has_urgency") or False
        merged["virality_signals"] = clf.get("virality_signals") or []
        results.append(merged)
    return results


def classify_caption_batch(captions: list, batch_size: int = 20) -> list:
    """
    Classify captions using Claude CLI in parallel batches (4 workers).

    Each input dict must have: {'id': str, 'caption': str, 'platform': str}
    Returns the enriched list (same order as input).
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    if not captions:
        return []

    batches = [captions[i:i + batch_size] for i in range(0, len(captions), batch_size)]
    total_batches = len(batches)
    ordered_results: list = [None] * total_batches

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(_classify_single_batch, batch, i + 1, total_batches): i
            for i, batch in enumerate(batches)
        }
        for future in as_completed(futures):
            idx = futures[future]
            try:
                ordered_results[idx] = future.result()
            except Exception:
                # Fall back to empty classifications for this batch
                ordered_results[idx] = [
                    {**item, "intent": None, "seasonal_tag": None, "tone": None,
                     "key_topics": [], "product_category": None, "hook_type": None,
                     "has_urgency": False, "virality_signals": []}
                    for item in batches[idx]
                ]

    # Flatten in order
    flat: list = []
    for batch_result in ordered_results:
        if batch_result:
            flat.extend(batch_result)
    return flat
```

**3b — Add SEO per-post fields in `run_caption_analysis()`:**

In the existing `run_caption_analysis()` function, after the section that builds `enriched_stories` and `enriched_reels` (Step 1 block, around line 476), add SEO scoring for each enriched item:

```python
    # ── SEO scoring for IG stories ───────────────────────────────────────────
    for story in enriched_stories:
        caption = story.get("description") or ""
        features = story.get("caption_features", {})
        seo = calculate_seo_score(caption, features)
        story.update({
            "seo_score":          seo["seo_score"],
            "seo_breakdown":      seo["seo_breakdown"],
            "hook_text":          seo["hook_text"],
            "hook_quality_label": seo["hook_quality_label"],
            "hashtag_quality":    seo["hashtag_quality"],
            "cta_type":           seo["cta_type"],
        })

    # ── SEO scoring for IG reels ─────────────────────────────────────────────
    for reel in enriched_reels:
        caption = reel.get("description") or ""
        features = reel.get("caption_features", {})
        seo = calculate_seo_score(caption, features)
        reel.update({
            "seo_score":          seo["seo_score"],
            "seo_breakdown":      seo["seo_breakdown"],
            "hook_text":          seo["hook_text"],
            "hook_quality_label": seo["hook_quality_label"],
            "hashtag_quality":    seo["hashtag_quality"],
            "cta_type":           seo["cta_type"],
        })
```

**3c — Add SEO aggregate stats before the final return in `run_caption_analysis()`:**

Before the `return { ... }` statement, insert:

```python
    # ── SEO aggregates ───────────────────────────────────────────────────────
    all_ig_scored = enriched_stories + enriched_reels
    seo_scores = [item.get("seo_score", 0) for item in all_ig_scored]
    avg_seo_score = round(sum(seo_scores) / len(seo_scores), 1) if seo_scores else 0.0

    seo_dist = {"0-25": 0, "26-50": 0, "51-75": 0, "76-100": 0}
    for s in seo_scores:
        if s <= 25:
            seo_dist["0-25"] += 1
        elif s <= 50:
            seo_dist["26-50"] += 1
        elif s <= 75:
            seo_dist["51-75"] += 1
        else:
            seo_dist["76-100"] += 1

    # Top recurring weak dimensions (aggregate breakdown scores)
    dim_totals: dict = {}
    dim_max: dict = {
        "hook_quality": 20, "keyword_relevance": 25, "hashtag_efficiency": 15,
        "cta_quality": 15, "brand_mentions": 10, "alt_text_flag": 10,
        "engagement_mechanics": 5,
    }
    if all_ig_scored:
        for item in all_ig_scored:
            for dim, max_pts in dim_max.items():
                earned = item.get("seo_breakdown", {}).get(dim, 0)
                pct = earned / max_pts if max_pts > 0 else 1.0
                dim_totals[dim] = dim_totals.get(dim, 0) + pct
        # Average fill-rate per dimension, sort ascending = weakest first
        dim_avg = {d: dim_totals[d] / len(all_ig_scored) for d in dim_totals}
        seo_top_issues = [d for d, _ in sorted(dim_avg.items(), key=lambda x: x[1])[:3]]
    else:
        seo_top_issues = []

    # Prescriptions based on top issues
    _prescriptions = {
        "hook_quality":         "Lead with a niche keyword in your first 125 characters — that's your Google meta description.",
        "keyword_relevance":    "Include 3–5 fashion/lifestyle keywords in every caption to improve discoverability.",
        "hashtag_efficiency":   "Use exactly 1–5 targeted hashtags. Posts with > 5 hashtags are algorithmically suppressed.",
        "cta_quality":          "Switch from 'link in bio' to 'DM me for the link' — DM CTAs convert 2–3× better.",
        "brand_mentions":       "Tag the brand (@brandname) in your caption to appear in brand search results.",
        "alt_text_flag":        "Describe what you're wearing/showing in the caption — IG uses this for accessibility indexing.",
        "engagement_mechanics": "End with a question or 'save this post' prompt to boost saves (saves = strongest revenue signal).",
    }
    seo_prescriptions = [_prescriptions[d] for d in seo_top_issues if d in _prescriptions]
    # Always include the saves tip if not already surfaced
    saves_tip = _prescriptions["engagement_mechanics"]
    if saves_tip not in seo_prescriptions:
        seo_prescriptions.append(saves_tip)
```

Then add to the return dict:
```python
        "avg_seo_score":          avg_seo_score,
        "seo_score_distribution": seo_dist,
        "seo_top_issues":         seo_top_issues,
        "seo_prescriptions":      seo_prescriptions,
```

- [ ] **Step 4: Run all NLP tests**

```bash
cd /Users/ethanatchley/creator-metrics/scripts/content-intelligence
python -m pytest tests/test_seo_score.py -v
```
Expected: All 14 tests pass. (Note: `test_run_caption_analysis_*` will skip Claude calls if no captions have text — that's fine, the test data has captions.)

- [ ] **Step 5: Commit**

```bash
cd /Users/ethanatchley/creator-metrics
git add scripts/content-intelligence/modules/caption_nlp.py \
        scripts/content-intelligence/tests/test_seo_score.py
git commit -m "feat(nlp): parallelize classify_caption_batch (4 workers) + add SEO aggregates to run_caption_analysis"
```

---

### Task 3: Update scoring.py composite formulas

**Files:**
- Modify: `scripts/content-intelligence/modules/scoring.py`
- Create: `scripts/content-intelligence/tests/test_scoring_seo.py`

- [ ] **Step 1: Write failing tests**

Create `scripts/content-intelligence/tests/test_scoring_seo.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from modules.scoring import score_ig_stories_batch, score_ig_reels_batch

def _story(views=1000, reach=900, likes=10, replies=2, follows=1,
           link_clicks=5, sticker_taps=0, seo_score=80):
    return {
        "views": views, "reach": reach, "likes": likes, "replies": replies,
        "follows": follows, "link_clicks": link_clicks, "sticker_taps": sticker_taps,
        "seo_score": seo_score,
    }

def _reel(views=5000, likes=100, comments=10, saves=50, shares=20, seo_score=75):
    return {
        "views": views, "likes": likes, "comments": comments,
        "saves": saves, "shares": shares, "seo_score": seo_score,
    }

def test_story_seo_score_field_present():
    stories = [_story(seo_score=80), _story(seo_score=20)]
    scored = score_ig_stories_batch(stories)
    assert "seo_score" in scored[0]

def test_story_composite_includes_seo_weight():
    """Story = 50% virality + 35% engagement + 15% SEO.
    With identical virality/engagement, higher SEO = higher composite."""
    base = {"views": 500, "reach": 400, "likes": 5, "replies": 1, "follows": 0,
            "link_clicks": 2, "sticker_taps": 0}
    high_seo = score_ig_stories_batch([{**base, "seo_score": 100}, {**base, "seo_score": 0}])
    assert high_seo[0]["composite_score"] > high_seo[1]["composite_score"]

def test_story_composite_formula():
    """With all three stories identical except SEO score, composite diff = 15% * seo_delta."""
    stories = [
        {**{"views": 500, "reach": 400, "likes": 5, "replies": 1, "follows": 0,
            "link_clicks": 2, "sticker_taps": 0}, "seo_score": 100},
        {**{"views": 500, "reach": 400, "likes": 5, "replies": 1, "follows": 0,
            "link_clicks": 2, "sticker_taps": 0}, "seo_score": 0},
    ]
    scored = score_ig_stories_batch(stories)
    diff = scored[0]["composite_score"] - scored[1]["composite_score"]
    # SEO component: 15% * (seo_percentile_rank_of_100 - seo_percentile_rank_of_0)
    # Both stories: one has seo_score=100, one has 0 → percentile ranks: 100% and 0%
    # Expected diff ≈ 15.0
    assert 10 < diff < 20  # allow scoring variance

def test_story_no_seo_score_defaults_zero():
    """Stories without seo_score field should not crash."""
    stories = [{"views": 100, "reach": 90, "likes": 1, "replies": 0, "follows": 0,
                "link_clicks": 0, "sticker_taps": 0}]
    scored = score_ig_stories_batch(stories)
    assert "composite_score" in scored[0]

def test_reel_composite_includes_seo_weight():
    """Reel = 44% virality + 27% engagement + 17% saves + 12% SEO.
    With identical base, higher SEO = higher composite."""
    base = {"views": 5000, "likes": 100, "comments": 10, "saves": 50, "shares": 20}
    scored = score_ig_reels_batch([{**base, "seo_score": 100}, {**base, "seo_score": 0}])
    assert scored[0]["composite_score"] > scored[1]["composite_score"]

def test_reel_no_seo_score_defaults_zero():
    reels = [{"views": 1000, "likes": 50, "comments": 5, "saves": 20, "shares": 10}]
    scored = score_ig_reels_batch(reels)
    assert "composite_score" in scored[0]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/ethanatchley/creator-metrics/scripts/content-intelligence
python -m pytest tests/test_scoring_seo.py -v
```
Expected: `test_story_composite_includes_seo_weight` and `test_reel_composite_includes_seo_weight` FAIL.

- [ ] **Step 3: Update `score_ig_stories_batch()` formula**

In `scoring.py`, find `score_ig_stories_batch()` (line ~229). Change the composite line and add seo_score support:

Old formula in the loop:
```python
        composite = round(virality * 0.60 + eng_score * 0.40, 1)
```

New — before the composite line, add:
```python
        seo_raw   = story.get("seo_score") or 0
        all_seo   = [s.get("seo_score") or 0 for s in stories]
        seo_score_pct = percentile_rank(seo_raw, all_seo)
```

Then change the composite line:
```python
        composite = round(virality * 0.50 + eng_score * 0.35 + seo_score_pct * 0.15, 1)
```

Also update the docstring: `composite_score: 50% virality + 35% engagement + 15% SEO`

Apply the same change to `score_ig_story()` (single-post function, line ~166).

- [ ] **Step 4: Update `score_ig_reels_batch()` formula**

In `scoring.py`, find `score_ig_reels_batch()` (line ~352). Old formula:
```python
        composite  = round(virality * 0.50 + eng_score * 0.30 + save_score * 0.20, 1)
```

New — before the composite line:
```python
        seo_raw      = reel.get("seo_score") or 0
        all_seo_r    = [r.get("seo_score") or 0 for r in reels]
        seo_score_pct = percentile_rank(seo_raw, all_seo_r)
```

Then change the composite line:
```python
        composite = round(virality * 0.44 + eng_score * 0.27 + save_score * 0.17 + seo_score_pct * 0.12, 1)
```

Also update `score_ig_reel()` (single-post function) with the same change. Update docstrings.

- [ ] **Step 5: Run all scoring tests**

```bash
cd /Users/ethanatchley/creator-metrics/scripts/content-intelligence
python -m pytest tests/test_scoring_seo.py -v
```
Expected: All 6 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/ethanatchley/creator-metrics
git add scripts/content-intelligence/modules/scoring.py \
        scripts/content-intelligence/tests/test_scoring_seo.py
git commit -m "feat(scoring): update IG Story (15% SEO) and Reel (12% SEO) composite formulas"
```

---

## Chunk 2: HTML Report — Section 7 overhaul + pipeline.py injections

### Task 4: Overhaul report_template.html Section 7

**Files:**
- Modify: `scripts/content-intelligence/templates/report_template.html`

**Context:** Section 7 is at lines 819–877. Section 7b "What Goes Viral" is at lines 879–903. Replace both with 7 panels. Section 8 "Seasonal Performance" starts at line 905 and must be preserved.

- [ ] **Step 1: Replace Section 7 + Section 7b HTML**

Find and replace from `<!-- ── Section 7: Caption Intelligence` through the closing `</div>` of Section 7b (line 903), replacing with:

```html
  <!-- ── Section 7: Caption Intelligence (SEO-enhanced) ──────── -->
  <div class="section">
    <div class="section-header">
      <span class="section-icon">✍️</span>
      <span class="section-title">Caption Intelligence</span>
      <span class="section-sub">IG SEO scoring, intent, hooks, engagement patterns &amp; prescriptions</span>
    </div>

    <!-- Panel 1: SEO Overview KPIs + distribution -->
    <div style="margin-bottom:32px;">
      <div style="font-size:13px;font-weight:600;color:var(--gray-600);margin-bottom:12px;text-transform:uppercase;letter-spacing:.05em;">IG SEO Overview</div>
      <div class="kpi-grid" id="seo-kpi-grid"><!-- populated by JS --></div>
      <div style="margin-top:16px;">
        <div style="font-size:12px;color:var(--gray-500);margin-bottom:8px;">Score Distribution</div>
        <div class="chart-wrap" style="height:80px;">
          <canvas id="seoDistributionChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Panel 2: Intent & Hook Distribution -->
    <div class="caption-charts-grid" style="margin-bottom:28px;">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--gray-600);margin-bottom:12px;">Caption Intent Distribution</div>
        <div class="chart-wrap" style="height:260px;">
          <canvas id="intentDistributionChart"></canvas>
        </div>
      </div>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--gray-600);margin-bottom:12px;">Hook Type Distribution</div>
        <div class="chart-wrap" style="height:260px;">
          <canvas id="hookDonutChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Panel 3: Engagement by Intent table -->
    <div style="margin-bottom:28px;">
      <div style="font-size:13px;font-weight:600;color:var(--gray-600);margin-bottom:12px;">Engagement by Intent</div>
      <div id="engagement-by-intent-table"><!-- populated by JS --></div>
    </div>

    <!-- Panel 4: Caption Length Performance -->
    <div style="margin-bottom:28px;">
      <div style="font-size:13px;font-weight:600;color:var(--gray-600);margin-bottom:12px;">Caption Length vs Performance</div>
      <div class="caption-length-cards" id="caption-length-cards"><!-- populated by JS --></div>
    </div>

    <!-- Panel 5: High-Performing Captions (125-char highlight) -->
    <div style="margin-bottom:28px;">
      <div style="font-size:13px;font-weight:600;color:var(--gray-600);margin-bottom:12px;">Top-Performing Captions <span style="font-weight:400;color:var(--gray-500);font-size:11px;">— first 125 chars = Google meta description</span></div>
      <div class="caption-examples" id="caption-examples"><!-- populated by JS --></div>
    </div>

    <!-- Panel 6: Prescription Box -->
    <div style="margin-bottom:28px;" id="prescription-box"><!-- populated by JS --></div>

    <!-- Panel 7: Promo Codes + Brand Mentions -->
    <div class="caption-lists-grid">
      <div class="mini-list-card">
        <div class="mini-list-title">Top Promo Codes</div>
        <div id="promo-codes-list"><!-- populated by JS --></div>
      </div>
      <div class="mini-list-card">
        <div class="mini-list-title">Top Brand Mentions</div>
        <div id="brand-mentions-list"><!-- populated by JS --></div>
      </div>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--gray-600);margin-bottom:12px;">Most Common Words</div>
        <div class="chart-wrap" style="height:320px;">
          <canvas id="captionWordsChart"></canvas>
        </div>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Add CSS for new components**

In the `<style>` block, add after existing `.caption-` classes:

```css
    /* SEO KPI grid */
    .kpi-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
    .kpi-card  { background:var(--surface-2); border:1px solid var(--border); border-radius:10px; padding:16px; text-align:center; }
    .kpi-value { font-size:28px; font-weight:700; color:var(--white); margin-bottom:4px; }
    .kpi-label { font-size:11px; color:var(--gray-500); text-transform:uppercase; letter-spacing:.05em; }

    /* Caption length cards */
    .caption-length-cards { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
    .length-card { background:var(--surface-2); border:1px solid var(--border); border-radius:10px; padding:14px; }
    .length-card-label { font-size:11px; font-weight:600; color:var(--gray-500); text-transform:uppercase; margin-bottom:4px; }
    .length-card-value { font-size:22px; font-weight:700; color:var(--white); }
    .length-card-sub   { font-size:11px; color:var(--gray-500); margin-top:4px; }
    .length-card.best  { border-color: var(--accent); }

    /* Prescription box */
    .prescription-box { background:var(--surface-2); border:1px solid var(--border); border-radius:12px; padding:20px; }
    .prescription-title { font-size:13px; font-weight:700; color:var(--white); margin-bottom:14px; display:flex; align-items:center; gap:8px; }
    .prescription-item { display:flex; align-items:flex-start; gap:10px; margin-bottom:10px; font-size:13px; color:var(--gray-300); line-height:1.5; }
    .prescription-dot  { width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-top:5px; }
    .dot-high    { background:#ef4444; }
    .dot-medium  { background:#f59e0b; }
    .dot-low     { background:#22c55e; }

    /* 125-char hook highlight in caption examples */
    .caption-hook-highlight { background:rgba(99,102,241,.15); border-left:3px solid var(--accent); padding:2px 6px; border-radius:0 4px 4px 0; }
    .seo-badge { display:inline-block; font-size:10px; font-weight:700; padding:2px 8px; border-radius:20px; margin-left:8px; }
    .seo-badge-strong   { background:rgba(34,197,94,.2);  color:#22c55e; }
    .seo-badge-moderate { background:rgba(245,158,11,.2); color:#f59e0b; }
    .seo-badge-weak     { background:rgba(239,68,68,.2);  color:#ef4444; }

    /* Engagement by intent table */
    .intent-table { width:100%; border-collapse:collapse; font-size:13px; }
    .intent-table th { text-align:left; padding:8px 12px; color:var(--gray-500); font-weight:500; border-bottom:1px solid var(--border); }
    .intent-table td { padding:8px 12px; color:var(--gray-300); border-bottom:1px solid rgba(255,255,255,.04); }
    .intent-table tr:hover td { background:var(--surface-2); }
```

- [ ] **Step 3: Add 7 JS render functions**

Find the closing `</script>` tag. Before it, insert the following functions (after the existing caption-related render functions):

```javascript
// ── Panel 1: SEO KPIs ─────────────────────────────────────────
function renderSeoKpis() {
  const avgScore  = reportData.avg_seo_score || 0;
  const stories   = (reportData.ig_stories || []);
  const reels     = (reportData.ig_reels || []);
  const allIG     = stories.concat(reels);
  const strongHooks = allIG.filter(p => p.hook_quality_label === 'strong').length;
  const strongPct   = allIG.length ? Math.round(strongHooks / allIG.length * 100) : 0;
  const optHash     = allIG.filter(p => p.hashtag_quality === 'optimal').length;
  const optHashPct  = allIG.length ? Math.round(optHash / allIG.length * 100) : 0;

  document.getElementById('seo-kpi-grid').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-value">${avgScore}</div>
      <div class="kpi-label">Avg SEO Score</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${strongPct}%</div>
      <div class="kpi-label">Posts with Strong Hook</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${optHashPct}%</div>
      <div class="kpi-label">Optimal Hashtag Count</div>
    </div>`;

  const dist = reportData.seo_score_distribution || {};
  const labels = ['0–25','26–50','51–75','76–100'];
  const vals   = [dist['0-25']||0, dist['26-50']||0, dist['51-75']||0, dist['76-100']||0];
  new Chart(document.getElementById('seoDistributionChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: vals,
        backgroundColor: ['#ef4444','#f59e0b','#6366f1','#22c55e'],
        borderRadius: 6, borderSkipped: false }]
    },
    options: { indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{x:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'#9ca3af'}},
              y:{grid:{display:false},ticks:{color:'#9ca3af'}}} }
  });
}

// ── Panel 3: Engagement by Intent table ──────────────────────
function renderEngagementByIntentTable() {
  const data = reportData.engagement_by_intent || {};
  if (!Object.keys(data).length) return;
  const rows = Object.entries(data)
    .sort((a,b) => (b[1].avg_views||0) - (a[1].avg_views||0))
    .map(([intent, d]) => `
      <tr>
        <td>${intent.replace(/_/g,' ')}</td>
        <td>${(d.avg_views||0).toLocaleString()}</td>
        <td>${(d.avg_link_clicks||0).toFixed(1)}</td>
        <td>${d.count||0}</td>
      </tr>`).join('');
  document.getElementById('engagement-by-intent-table').innerHTML = `
    <table class="intent-table">
      <thead><tr><th>Intent</th><th>Avg Views</th><th>Avg Link Clicks</th><th>Posts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Panel 4: Caption Length cards ────────────────────────────
function renderCaptionLengthCards() {
  const perf = reportData.caption_length_performance || {};
  const buckets = [
    { key:'short',      label:'Short',       sub:'< 50 chars' },
    { key:'medium',     label:'Medium',      sub:'50–150 chars' },
    { key:'long',       label:'Long',        sub:'150–300 chars' },
    { key:'extra_long', label:'Extra Long',  sub:'> 300 chars' },
  ];
  const best = buckets.reduce((b,c) =>
    ((perf[c.key]||{}).avg_views||0) > ((perf[b.key]||{}).avg_views||0) ? c : b,
    buckets[0]
  );
  const html = buckets.map(b => {
    const d = perf[b.key] || {};
    const isBest = b.key === best.key;
    return `<div class="length-card${isBest?' best':''}">
      <div class="length-card-label">${b.label} ${isBest?'★':''}</div>
      <div class="length-card-value">${(d.avg_views||0).toLocaleString()}</div>
      <div class="length-card-sub">${b.sub} · ${d.count||0} posts</div>
    </div>`;
  }).join('');
  document.getElementById('caption-length-cards').innerHTML = html;
}

// ── Panel 5: High-performing captions with 125-char highlight ─
function renderCaptionExamples() {
  const captions = reportData.high_performing_captions || [];
  if (!captions.length) { document.getElementById('caption-examples').innerHTML = '<p style="color:#6b7280">No caption data available.</p>'; return; }

  const html = captions.slice(0,5).map((c,i) => {
    const full    = c.caption || '';
    const hook    = full.slice(0,125);
    const rest    = full.slice(125);
    const seoLabel = c.hook_quality_label || 'weak';
    const badgeCls = `seo-badge seo-badge-${seoLabel}`;
    const seoScore = c.seo_score != null ? ` · ${c.seo_score}/100` : '';
    return `<div class="caption-example-card" style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:11px;font-weight:600;color:#9ca3af;">#${i+1} · ${c.platform||''} · ${(c.views||0).toLocaleString()} views</span>
        <span class="${badgeCls}">${seoLabel}${seoScore}</span>
      </div>
      <div style="font-size:13px;line-height:1.6;color:#d1d5db;">
        <span class="caption-hook-highlight">${escHtml(hook)}</span>${escHtml(rest)}
      </div>
    </div>`;
  }).join('');
  document.getElementById('caption-examples').innerHTML = html;
}
function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Panel 6: Prescription box ─────────────────────────────────
function renderPrescriptions() {
  const prescriptions = reportData.seo_prescriptions || [];
  const issues        = reportData.seo_top_issues    || [];
  if (!prescriptions.length) return;
  const colors = ['dot-high','dot-medium','dot-low'];
  const items = prescriptions.map((p,i) =>
    `<div class="prescription-item">
      <div class="prescription-dot ${colors[i % colors.length]}"></div>
      <div>${p}</div>
    </div>`
  ).join('');
  const issueText = issues.length
    ? `<div style="margin-top:12px;font-size:12px;color:#6b7280;">Top weak dimensions: ${issues.map(d=>d.replace(/_/g,' ')).join(' · ')}</div>`
    : '';
  document.getElementById('prescription-box').innerHTML = `
    <div class="prescription-box">
      <div class="prescription-title">💊 Caption Prescriptions</div>
      ${items}${issueText}
    </div>`;
}
```

- [ ] **Step 4: Wire the new render functions into the page `init` call**

Find the `window.addEventListener('load', ...)` block (or `DOMContentLoaded` / `initReport()` call) near the bottom of the `<script>` block. Add calls to the 7 new functions:

```javascript
    renderSeoKpis();
    renderEngagementByIntentTable();
    renderCaptionLengthCards();
    renderCaptionExamples();
    renderPrescriptions();
```

The existing `intentDistributionChart` and `hookDonutChart` canvas IDs are now reused in Panel 2. Verify the existing render functions for those charts still reference those IDs (they should already). If Section 7b had duplicate render calls, remove them.

- [ ] **Step 5: Add pipeline.py injections**

In `scripts/content-intelligence/pipeline.py`, find the line:
```python
    report_data['top_caption_words'] = caption_results.get('word_frequency', [])
```

After that block (after the last existing `report_data[...] = caption_results.get(...)` line around line 266), add:

```python
    # SEO aggregate fields for Section 7
    report_data['avg_seo_score']          = caption_results.get('avg_seo_score', 0)
    report_data['seo_score_distribution'] = caption_results.get('seo_score_distribution', {})
    report_data['seo_top_issues']         = caption_results.get('seo_top_issues', [])
    report_data['seo_prescriptions']      = caption_results.get('seo_prescriptions', [])
```

Also add `seo_score`, `hook_quality_label`, `seo_breakdown`, `hashtag_quality`, `cta_type` to `_ig_numeric_fields` guard — actually these are non-numeric, so add a `_ig_seo_fields` normalizer to avoid KeyError in reports:

Find the `_ig_numeric_fields` list and after `_normalize_post_numerics` calls for `ig_stories` and `ig_reels`, add:

```python
    # Ensure SEO fields have defaults
    _seo_defaults = {'seo_score': 0, 'hook_quality_label': 'weak',
                     'hashtag_quality': 'none', 'cta_type': 'none',
                     'seo_breakdown': {}, 'hook_text': ''}
    for collection in (data_for_report['ig_stories'], data_for_report['ig_reels']):
        for item in collection:
            for k, v in _seo_defaults.items():
                if item.get(k) is None:
                    item[k] = v
```

- [ ] **Step 6: Smoke test the report pipeline**

```bash
cd /Users/ethanatchley/creator-metrics/scripts/content-intelligence
python pipeline.py --data-dir /Users/ethanatchley/Downloads \
  --output output/test_seo_report.html \
  --fast --use-caption-cache 2>&1 | tail -20
open output/test_seo_report.html
```

Verify in browser: Section 7 shows SEO KPIs, 7 panels visible, no JS console errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/ethanatchley/creator-metrics
git add scripts/content-intelligence/templates/report_template.html \
        scripts/content-intelligence/pipeline.py
git commit -m "feat(report): overhaul Section 7 Caption Intelligence with 7 SEO panels"
```

---

## Chunk 3: Vercel — Database + API

### Task 5: Add `captionAnalysis` Drizzle table + migration

**Files:**
- Modify: `lib/schema.ts`
- Create: `drizzle/0011_caption_analysis.sql`

Note: migration `0010_schema_additions.sql` already exists — use `0011`.

- [ ] **Step 1: Add table to schema.ts**

At the end of `lib/schema.ts`, append:

```typescript
export const captionAnalysis = pgTable(
  "caption_analysis",
  {
    id:               serial("id").primaryKey(),
    mediaIgId:        text("media_ig_id").notNull(),
    creatorId:        text("creator_id").notNull(),
    captionHash:      text("caption_hash").notNull(),
    seoScore:         integer("seo_score"),
    seoBreakdown:     jsonb("seo_breakdown"),
    hookText:         text("hook_text"),
    hookQualityLabel: text("hook_quality_label"),
    hashtagQuality:   text("hashtag_quality"),
    ctaType:          text("cta_type"),
    intent:           text("intent"),
    tone:             text("tone"),
    hookType:         text("hook_type"),
    keyTopics:        jsonb("key_topics"),
    productCategory:  text("product_category"),
    hasUrgency:       boolean("has_urgency").default(false),
    viralitySignals:  jsonb("virality_signals"),
    recommendations:  jsonb("recommendations"),
    analyzedAt:       timestamp("analyzed_at").defaultNow(),
  },
  (table) => [
    unique().on(table.mediaIgId, table.creatorId),
  ]
);
```

- [ ] **Step 2: Write migration SQL**

Create `drizzle/0011_caption_analysis.sql`:

```sql
CREATE TABLE IF NOT EXISTS "caption_analysis" (
  "id"                serial PRIMARY KEY,
  "media_ig_id"       text NOT NULL,
  "creator_id"        text NOT NULL,
  "caption_hash"      text NOT NULL,
  "seo_score"         integer,
  "seo_breakdown"     jsonb,
  "hook_text"         text,
  "hook_quality_label" text,
  "hashtag_quality"   text,
  "cta_type"          text,
  "intent"            text,
  "tone"              text,
  "hook_type"         text,
  "key_topics"        jsonb,
  "product_category"  text,
  "has_urgency"       boolean DEFAULT false,
  "virality_signals"  jsonb,
  "recommendations"   jsonb,
  "analyzed_at"       timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "caption_analysis_media_creator_uniq"
  ON "caption_analysis" ("media_ig_id", "creator_id");
```

- [ ] **Step 3: Run migration against Supabase**

```bash
cd /Users/ethanatchley/creator-metrics
DATABASE_URL=$(doppler secrets get DATABASE_URL --project ent-agency-automation --config dev --plain) \
  npx drizzle-kit push 2>&1 | tail -20
```

Or run the SQL directly:
```bash
PGPASSWORD=$(doppler secrets get SUPABASE_PASSWORD --project ent-agency-automation --config dev --plain) \
  psql "$(doppler secrets get DATABASE_URL --project ent-agency-automation --config dev --plain)" \
  -f drizzle/0011_caption_analysis.sql
```

Expected: `CREATE TABLE` and `CREATE INDEX` with no errors.

- [ ] **Step 4: Verify in Supabase dashboard or psql**

```bash
psql "$(doppler secrets get DATABASE_URL --project ent-agency-automation --config dev --plain)" \
  -c "\d caption_analysis"
```

Expected: 20-column table with the unique constraint visible.

- [ ] **Step 5: Commit**

```bash
cd /Users/ethanatchley/creator-metrics
git add lib/schema.ts drizzle/0011_caption_analysis.sql
git commit -m "feat(db): add caption_analysis table with SEO fields (migration 0011)"
```

---

### Task 6: Query layer (`lib/caption-queries.ts`)

**Files:**
- Create: `lib/caption-queries.ts`

- [ ] **Step 1: Create the query file**

Create `lib/caption-queries.ts`:

```typescript
import { db } from "@/lib/db";
import { captionAnalysis, mediaSnapshots } from "@/lib/schema";
import { eq, desc, sql, and } from "drizzle-orm";

export type CaptionPost = {
  id: number;
  mediaIgId: string;
  creatorId: string;
  seoScore: number | null;
  hookQualityLabel: string | null;
  hashtagQuality: string | null;
  ctaType: string | null;
  intent: string | null;
  hookType: string | null;
  analyzedAt: Date;
  caption: string | null;
  saves: number | null;
};

export type ScoreDistribution = {
  "0-25": number;
  "26-50": number;
  "51-75": number;
  "76-100": number;
};

export async function getCaptionScoreDistribution(
  creatorId: string
): Promise<ScoreDistribution> {
  const rows = await db
    .select({ seoScore: captionAnalysis.seoScore })
    .from(captionAnalysis)
    .where(eq(captionAnalysis.creatorId, creatorId));

  const dist: ScoreDistribution = { "0-25": 0, "26-50": 0, "51-75": 0, "76-100": 0 };
  for (const { seoScore } of rows) {
    const s = seoScore ?? 0;
    if (s <= 25) dist["0-25"]++;
    else if (s <= 50) dist["26-50"]++;
    else if (s <= 75) dist["51-75"]++;
    else dist["76-100"]++;
  }
  return dist;
}

export async function getTopCaptionIssues(
  creatorId: string
): Promise<string[]> {
  const rows = await db
    .select({ seoBreakdown: captionAnalysis.seoBreakdown })
    .from(captionAnalysis)
    .where(eq(captionAnalysis.creatorId, creatorId));

  const dimTotals: Record<string, number> = {};
  const dimMax: Record<string, number> = {
    hook_quality: 20, keyword_relevance: 25, hashtag_efficiency: 15,
    cta_quality: 15, brand_mentions: 10, alt_text_flag: 10, engagement_mechanics: 5,
  };

  let n = 0;
  for (const { seoBreakdown } of rows) {
    if (!seoBreakdown || typeof seoBreakdown !== "object") continue;
    const bd = seoBreakdown as Record<string, number>;
    n++;
    for (const [dim, maxPts] of Object.entries(dimMax)) {
      const earned = bd[dim] ?? 0;
      dimTotals[dim] = (dimTotals[dim] ?? 0) + earned / maxPts;
    }
  }

  if (!n) return [];
  const avgFill = Object.entries(dimTotals).map(([d, total]) => ({
    dim: d,
    avg: total / n,
  }));
  return avgFill
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 3)
    .map((x) => x.dim);
}

export async function getCaptionPosts(
  creatorId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<CaptionPost[]> {
  const { limit = 25, offset = 0 } = opts;
  const rows = await db
    .select({
      id:               captionAnalysis.id,
      mediaIgId:        captionAnalysis.mediaIgId,
      creatorId:        captionAnalysis.creatorId,
      seoScore:         captionAnalysis.seoScore,
      hookQualityLabel: captionAnalysis.hookQualityLabel,
      hashtagQuality:   captionAnalysis.hashtagQuality,
      ctaType:          captionAnalysis.ctaType,
      intent:           captionAnalysis.intent,
      hookType:         captionAnalysis.hookType,
      analyzedAt:       captionAnalysis.analyzedAt,
      caption:          mediaSnapshots.caption,
      saves:            mediaSnapshots.saved,
    })
    .from(captionAnalysis)
    .leftJoin(
      mediaSnapshots,
      and(
        eq(mediaSnapshots.mediaIgId, captionAnalysis.mediaIgId),
        eq(mediaSnapshots.creatorId, captionAnalysis.creatorId)
      )
    )
    .where(eq(captionAnalysis.creatorId, creatorId))
    .orderBy(desc(captionAnalysis.seoScore))
    .limit(limit)
    .offset(offset);

  return rows as CaptionPost[];
}

export async function getCaptionPrescription(
  creatorId: string
): Promise<string[]> {
  const issues = await getTopCaptionIssues(creatorId);

  const prescriptionMap: Record<string, string> = {
    hook_quality:         "Lead with a niche keyword in your first 125 characters — that's your Google meta description.",
    keyword_relevance:    "Include 3–5 fashion/lifestyle keywords in every caption to improve discoverability.",
    hashtag_efficiency:   "Use exactly 1–5 targeted hashtags. Posts with > 5 hashtags are algorithmically suppressed.",
    cta_quality:          "Switch from 'link in bio' to 'DM me for the link' — DM CTAs convert 2–3× better.",
    brand_mentions:       "Tag the brand (@brandname) in your caption to appear in brand search results.",
    alt_text_flag:        "Describe what you're wearing/showing in the caption — IG uses this for accessibility indexing.",
    engagement_mechanics: "End with a question or 'save this post' prompt to boost saves (saves = strongest revenue signal).",
  };

  const prescriptions = issues
    .filter((d) => prescriptionMap[d])
    .map((d) => prescriptionMap[d]);

  const savesTip = prescriptionMap["engagement_mechanics"];
  if (!prescriptions.includes(savesTip)) prescriptions.push(savesTip);
  return prescriptions;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/ethanatchley/creator-metrics
npx tsc --noEmit 2>&1 | head -30
```
Expected: No errors related to `caption-queries.ts`.

- [ ] **Step 3: Commit**

```bash
cd /Users/ethanatchley/creator-metrics
git add lib/caption-queries.ts
git commit -m "feat(db): add caption-queries.ts — score distribution, issues, posts, prescriptions"
```

---

### Task 7: Cron + on-demand API routes

**Files:**
- Create: `app/api/cron/caption-analyze/route.ts`
- Create: `app/api/intelligence/caption-score/route.ts`
- Modify: `vercel.json` (add cron schedule)

- [ ] **Step 1: Create the cron route**

Reference an existing cron route (e.g., `app/api/cron/collect/route.ts`) to understand the auth pattern. Then create `app/api/cron/caption-analyze/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { captionAnalysis, mediaSnapshots, creators } from "@/lib/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import crypto from "crypto";

const AGENT_SERVER = "https://ent-agent-server-production.up.railway.app";
const BATCH_SIZE = 30;

function captionHash(caption: string): string {
  return crypto.createHash("sha256").update(caption ?? "").digest("hex").slice(0, 16);
}

async function analyzeCaption(
  mediaIgId: string,
  creatorId: string,
  caption: string
) {
  const prompt = `You are analyzing an Instagram caption for SEO and engagement optimization.
Analyze this caption and return a JSON object with these fields:
- seo_score: integer 0-100
- seo_breakdown: object with keys hook_quality(0-20), keyword_relevance(0-25), hashtag_efficiency(0-15), cta_quality(0-15), brand_mentions(0-10), alt_text_flag(0-10), engagement_mechanics(0-5)
- hook_text: first 125 characters of caption
- hook_quality_label: "strong" | "moderate" | "weak"
- hashtag_quality: "optimal" | "over_limit" | "none"
- cta_type: "dm" | "link_bio" | "none"
- intent: one of sale_promotion|product_showcase|lifestyle|entertainment|educational|call_to_action|personal_story|trend_moment
- tone: casual|excited|informative|humorous|aspirational
- hook_type: discount|trend|relatable_humor|aspiration|education|challenge|personal_story|product_reveal
- key_topics: array of 2-4 strings
- product_category: fashion|fitness|home|beauty|food|travel|lifestyle|kids|other
- has_urgency: boolean
- virality_signals: array of 0-3 from relatable|funny|inspiring|informative|controversial|satisfying
- recommendations: array of 2-3 actionable strings

Caption: ${caption}

Return ONLY valid JSON, no markdown.`;

  const res = await fetch(`${AGENT_SERVER}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) throw new Error(`Agent server ${res.status}`);
  const { result } = await res.json();

  let parsed: Record<string, unknown>;
  try {
    const clean = result.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
    parsed = JSON.parse(clean);
  } catch {
    throw new Error("Failed to parse agent response as JSON");
  }

  return parsed;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get active creators
  const allCreators = await db
    .select({ id: creators.id })
    .from(creators)
    .where(eq(creators.isOwned, true));

  const creatorIds = allCreators.map((c) => c.id);
  if (!creatorIds.length) {
    return NextResponse.json({ processed: 0, message: "No owned creators" });
  }

  // Find posts not yet analyzed or with stale caption hash
  const toAnalyze = await db
    .select({
      mediaIgId: mediaSnapshots.mediaIgId,
      creatorId: mediaSnapshots.creatorId,
      caption:   mediaSnapshots.caption,
      existingHash: sql<string | null>`
        (SELECT caption_hash FROM caption_analysis ca
         WHERE ca.media_ig_id = ${mediaSnapshots.mediaIgId}
           AND ca.creator_id = ${mediaSnapshots.creatorId}
         LIMIT 1)
      `,
    })
    .from(mediaSnapshots)
    .where(inArray(mediaSnapshots.creatorId, creatorIds))
    .limit(BATCH_SIZE * 2); // overfetch to filter stale

  // Filter: not analyzed OR caption changed
  // Filter: not analyzed OR caption changed
  const pending = toAnalyze
    .filter((row) => {
      if (!row.caption) return false;
      const hash = captionHash(row.caption);
      return !row.existingHash || row.existingHash !== hash;
    })
    .slice(0, BATCH_SIZE);

  let processed = 0;
  let errors = 0;

  for (const row of pending) {
    try {
      const hash = captionHash(row.caption!);
      const analysis = await analyzeCaption(row.mediaIgId, row.creatorId, row.caption!);

      await db
        .insert(captionAnalysis)
        .values({
          mediaIgId:        row.mediaIgId,
          creatorId:        row.creatorId,
          captionHash:      hash,
          seoScore:         (analysis.seo_score as number) ?? null,
          seoBreakdown:     analysis.seo_breakdown ?? null,
          hookText:         (analysis.hook_text as string) ?? null,
          hookQualityLabel: (analysis.hook_quality_label as string) ?? null,
          hashtagQuality:   (analysis.hashtag_quality as string) ?? null,
          ctaType:          (analysis.cta_type as string) ?? null,
          intent:           (analysis.intent as string) ?? null,
          tone:             (analysis.tone as string) ?? null,
          hookType:         (analysis.hook_type as string) ?? null,
          keyTopics:        analysis.key_topics ?? null,
          productCategory:  (analysis.product_category as string) ?? null,
          hasUrgency:       (analysis.has_urgency as boolean) ?? false,
          viralitySignals:  analysis.virality_signals ?? null,
          recommendations:  analysis.recommendations ?? null,
        })
        .onConflictDoUpdate({
          target: [captionAnalysis.mediaIgId, captionAnalysis.creatorId],
          set: {
            captionHash:      hash,
            seoScore:         (analysis.seo_score as number) ?? null,
            seoBreakdown:     analysis.seo_breakdown ?? null,
            hookText:         (analysis.hook_text as string) ?? null,
            hookQualityLabel: (analysis.hook_quality_label as string) ?? null,
            hashtagQuality:   (analysis.hashtag_quality as string) ?? null,
            ctaType:          (analysis.cta_type as string) ?? null,
            intent:           (analysis.intent as string) ?? null,
            tone:             (analysis.tone as string) ?? null,
            hookType:         (analysis.hook_type as string) ?? null,
            keyTopics:        analysis.key_topics ?? null,
            productCategory:  (analysis.product_category as string) ?? null,
            hasUrgency:       (analysis.has_urgency as boolean) ?? false,
            viralitySignals:  analysis.virality_signals ?? null,
            recommendations:  analysis.recommendations ?? null,
            analyzedAt:       new Date(),
          },
        });

      processed++;
    } catch (err) {
      console.error(`Failed to analyze ${row.mediaIgId}:`, err);
      errors++;
    }
  }

  return NextResponse.json({ processed, errors, total: pending.length });
}
```

- [ ] **Step 2: Create on-demand route**

Create `app/api/intelligence/caption-score/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { captionAnalysis, mediaSnapshots } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

const AGENT_SERVER = "https://ent-agent-server-production.up.railway.app";

function captionHash(caption: string): string {
  return crypto.createHash("sha256").update(caption ?? "").digest("hex").slice(0, 16);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { creatorId, mediaIgId, forceRefresh } = body as {
    creatorId?: string;
    mediaIgId?: string;
    forceRefresh?: boolean;
  };

  if (!creatorId) {
    return NextResponse.json({ error: "creatorId required" }, { status: 400 });
  }

  if (!mediaIgId) {
    // Batch mode: queue up to 30 unanalyzed posts
    return NextResponse.json({
      status: "queued",
      message: "Call GET /api/cron/caption-analyze to process batch",
    });
  }

  // Single-post mode
  const [snapshot] = await db
    .select({ caption: mediaSnapshots.caption })
    .from(mediaSnapshots)
    .where(
      and(
        eq(mediaSnapshots.mediaIgId, mediaIgId),
        eq(mediaSnapshots.creatorId, creatorId)
      )
    )
    .limit(1);

  if (!snapshot?.caption) {
    return NextResponse.json({ error: "Post not found or no caption" }, { status: 404 });
  }

  const hash = captionHash(snapshot.caption);

  // Check cache unless forceRefresh
  if (!forceRefresh) {
    const [existing] = await db
      .select()
      .from(captionAnalysis)
      .where(
        and(
          eq(captionAnalysis.mediaIgId, mediaIgId),
          eq(captionAnalysis.creatorId, creatorId)
        )
      )
      .limit(1);

    if (existing && existing.captionHash === hash) {
      return NextResponse.json({ cached: true, analysis: existing });
    }
  }

  // Call agent server
  const prompt = `Analyze this Instagram caption for SEO and engagement. Return JSON with:
seo_score(0-100), seo_breakdown(object), hook_text(first 125 chars), hook_quality_label(strong|moderate|weak),
hashtag_quality(optimal|over_limit|none), cta_type(dm|link_bio|none), intent, tone, hook_type,
key_topics(array), product_category, has_urgency(bool), virality_signals(array), recommendations(array).

Caption: ${snapshot.caption}

Return ONLY valid JSON.`;

  const res = await fetch(`${AGENT_SERVER}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Agent server error" }, { status: 502 });
  }

  const { result } = await res.json();
  let analysis: Record<string, unknown>;
  try {
    const clean = result.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
    analysis = JSON.parse(clean);
  } catch {
    return NextResponse.json({ error: "Failed to parse analysis" }, { status: 500 });
  }

  const row = {
    mediaIgId, creatorId, captionHash: hash,
    seoScore:         (analysis.seo_score as number) ?? null,
    seoBreakdown:     analysis.seo_breakdown ?? null,
    hookText:         (analysis.hook_text as string) ?? null,
    hookQualityLabel: (analysis.hook_quality_label as string) ?? null,
    hashtagQuality:   (analysis.hashtag_quality as string) ?? null,
    ctaType:          (analysis.cta_type as string) ?? null,
    intent:           (analysis.intent as string) ?? null,
    tone:             (analysis.tone as string) ?? null,
    hookType:         (analysis.hook_type as string) ?? null,
    keyTopics:        analysis.key_topics ?? null,
    productCategory:  (analysis.product_category as string) ?? null,
    hasUrgency:       (analysis.has_urgency as boolean) ?? false,
    viralitySignals:  analysis.virality_signals ?? null,
    recommendations:  analysis.recommendations ?? null,
  };

  await db
    .insert(captionAnalysis)
    .values(row)
    .onConflictDoUpdate({
      target: [captionAnalysis.mediaIgId, captionAnalysis.creatorId],
      set: { ...row, analyzedAt: new Date() },
    });

  return NextResponse.json({ cached: false, analysis: row });
}
```

- [ ] **Step 3: Add cron schedule to vercel.json**

Read `vercel.json`, find the `crons` array, and add:

```json
{ "path": "/api/cron/caption-analyze", "schedule": "0 9 * * *" }
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd /Users/ethanatchley/creator-metrics
npx tsc --noEmit 2>&1 | head -30
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/ethanatchley/creator-metrics
git add app/api/cron/caption-analyze/route.ts \
        app/api/intelligence/caption-score/route.ts \
        vercel.json
git commit -m "feat(api): add caption-analyze cron + caption-score on-demand route"
```

---

## Chunk 4: Vercel UI — Page + Components + Tab

### Task 8: IntelligenceTabs — add Captions tab

**Files:**
- Modify: `components/IntelligenceTabs.tsx`

- [ ] **Step 1: Add the Captions tab**

In `components/IntelligenceTabs.tsx`, find the `TABS` array and add the 4th entry:

```typescript
const TABS = [
  { path: "/dashboard/intelligence/search",   label: "Search"   },
  { path: "/dashboard/intelligence/insights",  label: "Insights" },
  { path: "/dashboard/intelligence/trends",    label: "Trends"   },
  { path: "/dashboard/intelligence/captions",  label: "Captions" },
];
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /Users/ethanatchley/creator-metrics
npx tsc --noEmit 2>&1 | grep IntelligenceTabs
```

- [ ] **Step 3: Commit**

```bash
cd /Users/ethanatchley/creator-metrics
git add components/IntelligenceTabs.tsx
git commit -m "feat(ui): add Captions as 4th Intelligence tab"
```

---

### Task 9: Caption Intelligence page + components

**Files:**
- Create: `app/dashboard/intelligence/captions/page.tsx`
- Create: `components/CaptionScoreHistogram.tsx`
- Create: `components/CaptionPostTable.tsx`
- Create: `components/PrescriptionPanel.tsx`
- Create: `components/ReanalyzeButton.tsx`

- [ ] **Step 1: Create `CaptionScoreHistogram.tsx`**

```typescript
"use client";
import type { ScoreDistribution } from "@/lib/caption-queries";

export function CaptionScoreHistogram({ dist }: { dist: ScoreDistribution }) {
  const buckets = [
    { label: "0–25",    value: dist["0-25"],   color: "bg-red-500" },
    { label: "26–50",   value: dist["26-50"],  color: "bg-yellow-500" },
    { label: "51–75",   value: dist["51-75"],  color: "bg-indigo-500" },
    { label: "76–100",  value: dist["76-100"], color: "bg-green-500" },
  ];
  const max = Math.max(...buckets.map((b) => b.value), 1);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
        SEO Score Distribution
      </h3>
      <div className="space-y-3">
        {buckets.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-14 text-right">{b.label}</span>
            <div className="flex-1 bg-gray-800 rounded-full h-5 overflow-hidden">
              <div
                className={`h-full ${b.color} rounded-full transition-all`}
                style={{ width: `${(b.value / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 w-6">{b.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `CaptionPostTable.tsx`**

```typescript
import type { CaptionPost } from "@/lib/caption-queries";

const SEO_COLORS: Record<string, string> = {
  strong:   "text-green-400 bg-green-900/30",
  moderate: "text-yellow-400 bg-yellow-900/30",
  weak:     "text-red-400 bg-red-900/30",
};

export function CaptionPostTable({ posts }: { posts: CaptionPost[] }) {
  if (!posts.length) {
    return <p className="text-gray-500 text-sm">No analyzed captions yet. Run the analyzer to get started.</p>;
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800">
            <th className="text-left px-4 py-3 text-gray-500 font-medium">Caption</th>
            <th className="text-left px-4 py-3 text-gray-500 font-medium">SEO Score</th>
            <th className="text-left px-4 py-3 text-gray-500 font-medium">Hook</th>
            <th className="text-left px-4 py-3 text-gray-500 font-medium">Hashtags</th>
            <th className="text-left px-4 py-3 text-gray-500 font-medium">CTA</th>
            <th className="text-left px-4 py-3 text-gray-500 font-medium">Intent</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => {
            const label = post.hookQualityLabel ?? "weak";
            const badgeCls = SEO_COLORS[label] ?? SEO_COLORS.weak;
            return (
              <tr key={post.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                <td className="px-4 py-3 text-gray-300 max-w-xs">
                  <p className="truncate">{post.caption ?? "—"}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${badgeCls}`}>
                    {post.seoScore ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 capitalize">{label}</td>
                <td className="px-4 py-3 text-gray-400 capitalize">{post.hashtagQuality ?? "—"}</td>
                <td className="px-4 py-3 text-gray-400 capitalize">{post.ctaType ?? "—"}</td>
                <td className="px-4 py-3 text-gray-400 capitalize">
                  {post.intent?.replace(/_/g, " ") ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Create `PrescriptionPanel.tsx`**

```typescript
const PRIORITY_COLORS = ["bg-red-500", "bg-yellow-500", "bg-green-500"];

export function PrescriptionPanel({
  prescriptions,
  issues,
}: {
  prescriptions: string[];
  issues: string[];
}) {
  if (!prescriptions.length) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
        <span>💊</span> Caption Prescriptions
      </h3>
      <ul className="space-y-3">
        {prescriptions.map((p, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-gray-300">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${
                PRIORITY_COLORS[i % PRIORITY_COLORS.length]
              }`}
            />
            {p}
          </li>
        ))}
      </ul>
      {issues.length > 0 && (
        <p className="mt-4 text-xs text-gray-600">
          Top weak dimensions: {issues.map((d) => d.replace(/_/g, " ")).join(" · ")}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `ReanalyzeButton.tsx`**

```typescript
"use client";
import { useState } from "react";

export function ReanalyzeButton({ creatorId }: { creatorId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleClick = async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/intelligence/caption-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorId }),
      });
      if (!res.ok) throw new Error("Request failed");
      setStatus("done");
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const labels: Record<typeof status, string> = {
    idle:    "Re-analyze Captions",
    loading: "Queuing...",
    done:    "✓ Queued",
    error:   "Error — retry?",
  };

  return (
    <button
      onClick={handleClick}
      disabled={status === "loading"}
      className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-colors"
    >
      {labels[status]}
    </button>
  );
}
```

- [ ] **Step 5: Create the page**

Create `app/dashboard/intelligence/captions/page.tsx`:

```typescript
import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  getCaptionScoreDistribution,
  getTopCaptionIssues,
  getCaptionPosts,
  getCaptionPrescription,
} from "@/lib/caption-queries";
import { CaptionScoreHistogram } from "@/components/CaptionScoreHistogram";
import { CaptionPostTable }      from "@/components/CaptionPostTable";
import { PrescriptionPanel }     from "@/components/PrescriptionPanel";
import { ReanalyzeButton }       from "@/components/ReanalyzeButton";

export default async function CaptionsPage({
  searchParams,
}: {
  searchParams: { creatorId?: string };
}) {
  // Resolve creatorId the same way as other Intelligence pages (trends, insights)
  const creatorId = searchParams.creatorId ?? "nicki_entenmann";
  if (!creatorId) redirect("/dashboard");

  // Parallel data fetch
  const [dist, issues, posts, prescriptions] = await Promise.all([
    getCaptionScoreDistribution(creatorId),
    getTopCaptionIssues(creatorId),
    getCaptionPosts(creatorId, { limit: 25 }),
    getCaptionPrescription(creatorId),
  ]);

  const avgScore =
    posts.length > 0
      ? Math.round(
          posts.reduce((s, p) => s + (p.seoScore ?? 0), 0) / posts.length
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-500 text-sm">
            Avg SEO Score:{" "}
            <span className="text-white font-semibold">{avgScore}/100</span>
            {" "}· {posts.length} analyzed
          </p>
        </div>
        <ReanalyzeButton creatorId={creatorId} />
      </div>

      {/* Score distribution */}
      <CaptionScoreHistogram dist={dist} />

      {/* Prescriptions */}
      <PrescriptionPanel prescriptions={prescriptions} issues={issues} />

      {/* Post table */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Analyzed Posts
        </h3>
        <Suspense fallback={<p className="text-gray-500 text-sm">Loading...</p>}>
          <CaptionPostTable posts={posts} />
        </Suspense>
      </div>
    </div>
  );
}
```

**Note:** If `getCreatorId()` doesn't exist in `lib/creator-utils`, check how other Intelligence pages resolve the creator. Look at `app/dashboard/intelligence/trends/page.tsx` for the pattern and replicate it.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/ethanatchley/creator-metrics
npx tsc --noEmit 2>&1 | head -40
```
Expected: No errors.

- [ ] **Step 7: Local dev test**

```bash
cd /Users/ethanatchley/creator-metrics
npm run dev
```
Visit `http://localhost:3000/dashboard/intelligence/captions` — verify:
- 4 tabs visible including "Captions"
- Page loads without 500 error (may show empty state if no data yet)
- ReanalyzeButton is present and clickable

- [ ] **Step 8: Commit**

```bash
cd /Users/ethanatchley/creator-metrics
git add app/dashboard/intelligence/captions/page.tsx \
        components/CaptionScoreHistogram.tsx \
        components/CaptionPostTable.tsx \
        components/PrescriptionPanel.tsx \
        components/ReanalyzeButton.tsx
git commit -m "feat(ui): add /dashboard/intelligence/captions page with 4 components"
```

---

## Chunk 5: End-to-end verification

### Task 10: Full pipeline smoke test + Vercel deploy

- [ ] **Step 1: Run full Python pipeline (fast mode)**

```bash
cd /Users/ethanatchley/creator-metrics/scripts/content-intelligence
python pipeline.py --data-dir /Users/ethanatchley/Downloads \
  --output output/nicki_spring_2025_report.html \
  --fast --use-caption-cache 2>&1
```

Expected output contains:
- `Step 4/6: Loading caption results from cache...`
- `Step 5/6: Computing performance scores...`
- `Step 6/6: Generating HTML report...`
- `✅ Report generated`

- [ ] **Step 2: Open report and verify Section 7**

```bash
open /Users/ethanatchley/creator-metrics/scripts/content-intelligence/output/nicki_spring_2025_report.html
```

Verify in browser:
- Section 7 title: "Caption Intelligence"
- Panel 1 (SEO KPIs) renders 3 cards
- Score distribution bar chart visible
- Panel 6 (Prescription Box) renders with colored dots
- No JavaScript console errors (open DevTools → Console)

- [ ] **Step 3: Run Python test suite**

```bash
cd /Users/ethanatchley/creator-metrics/scripts/content-intelligence
python -m pytest tests/ -v
```
Expected: All tests pass.

- [ ] **Step 4: Deploy to Vercel**

```bash
cd /Users/ethanatchley/creator-metrics
vercel --prod 2>&1 | tail -20
```
Expected: Deployment URL printed, no build errors.

- [ ] **Step 5: Smoke test live Vercel**

Visit `https://creator-metrics.vercel.app/dashboard/intelligence/captions`

Verify:
- "Captions" tab is the 4th tab
- Page renders without 500 error
- ReanalyzeButton is present

- [ ] **Step 6: Test cron endpoint manually**

```bash
curl -X GET "https://creator-metrics.vercel.app/api/cron/caption-analyze" \
  -H "Authorization: Bearer $(doppler secrets get CRON_SECRET --project ent-agency-automation --config dev --plain)" \
  -s | jq .
```
Expected: `{ "processed": N, "errors": 0, "total": N }`

- [ ] **Step 7: Final commit**

```bash
cd /Users/ethanatchley/creator-metrics
git add -A
git commit -m "feat: caption intelligence v1 — SEO scoring, updated composites, HTML report overhaul, Vercel page"
```
