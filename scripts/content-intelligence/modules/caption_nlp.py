"""
caption_nlp.py — Caption NLP analysis module for the Content Intelligence Pipeline.

Analyzes Spring 2025 Instagram and LTK captions for Nicki Entenmann to surface
caption patterns that drive engagement and affiliate revenue.
"""

import json
import os
import re
import subprocess
from collections import Counter
from typing import Optional


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CAPTION_INTENTS = [
    "sale_promotion",
    "product_showcase",
    "lifestyle",
    "entertainment",
    "educational",
    "call_to_action",
    "personal_story",
    "trend_moment",
]

SEASONAL_TAGS = [
    "st_patricks_day",
    "easter",
    "spring",
    "summer_preview",
    "memorial_day",
    "mothers_day",
    "generic",
]

STOP_WORDS = {
    "the", "a", "an", "in", "on", "at", "to", "for", "of", "and", "or",
    "but", "is", "are", "was", "were", "be", "been", "have", "has", "had",
    "do", "does", "did", "will", "would", "can", "could", "should", "may",
    "might", "i", "me", "my", "you", "your", "it", "its", "this", "that",
    "so", "just", "if", "with", "from",
    # Instagram filler words
    "lol", "omg", "like", "get", "go", "got", "one", "im", "its", "all",
    "now", "see", "use", "up", "new", "no", "out", "more", "here", "re",
    "us", "too", "oh", "yay", "haha", "hey", "ok", "okay", "wow", "yes",
    "love", "also", "still", "even", "really", "just", "ive", "dont",
    "cant", "thats", "theyre",
}

# ---------------------------------------------------------------------------
# SEO scoring (IG July 2025 Google indexing update)
# ---------------------------------------------------------------------------

_RE_HASHTAG = re.compile(r"#\w+")
_RE_MENTION = re.compile(r"@(\w+)")

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
        hook_pts += 3
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
    hashtag_count = features.get("hashtag_count") if features else None
    if hashtag_count is None:
        hashtag_count = len(_RE_HASHTAG.findall(caption))
    hashtag_count = int(hashtag_count)

    if hashtag_count == 0:
        hashtag_pts = 7
        hashtag_quality = "none"
    elif 1 <= hashtag_count <= 5:
        hashtag_pts = 15
        hashtag_quality = "optimal"
    else:
        hashtag_pts = 0
        hashtag_quality = "over_limit"

    # ── CTA quality ───────────────────────────────────────────────────
    if _RE_DM_CTA.search(caption):
        cta_pts = 15
        cta_type = "dm"
    elif _RE_LINK_BIO_CTA.search(caption):
        cta_pts = 8
        cta_type = "link_bio"
    else:
        cta_pts = 0
        cta_type = "none"

    # ── Brand mentions ────────────────────────────────────────────────
    mention_count = features.get("mention_count") if features else None
    if mention_count is None:
        mention_count = len(_RE_MENTION.findall(caption))
    brand_pts = min(int(mention_count) * 4, 10)

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
    total = int(sum(breakdown.values()))

    return {
        "seo_score":          total,
        "seo_breakdown":      breakdown,
        "hook_text":          hook_text,
        "hook_quality_label": hook_quality_label,
        "hashtag_quality":    hashtag_quality,
        "cta_type":           cta_type,
    }


PRODUCT_KEYWORDS = [
    "swimwear", "swimsuit", "bikini", "dress", "denim", "jeans", "athleisure",
    "leggings", "sneakers", "shoes", "bag", "purse", "jacket", "cardigan",
    "linen", "shorts", "skirt", "bodysuit", "lounge", "pajama", "workout",
    "activewear", "sandals", "heels", "boots", "sunglasses", "jewelry",
    "accessory",
]

POSITIVE_WORDS = {
    "love", "obsessed", "amazing", "favorite", "great", "perfect", "best",
    "gorgeous", "cute", "beautiful", "adorable", "excited", "thrilled",
    "happy", "wonderful", "incredible", "awesome", "fantastic",
}

NEGATIVE_WORDS = {
    "bad", "hate", "terrible", "awful", "worst", "disappointed", "boring",
    "ugly", "cheap", "overpriced", "disappointing",
}

URGENCY_PATTERNS = re.compile(
    r"\b(24\s*hours?\s*only|limited\s*time|ends?\s*soon|today\s*only|"
    r"last\s*chance|selling\s*out|almost\s*gone|while\s*supplies?\s*last|"
    r"flash\s*sale|expires?\s*(tonight|today|soon)|don'?t\s*miss)\b",
    re.IGNORECASE,
)

DISCOUNT_AMOUNT_PATTERN = re.compile(
    r"(\d+%\s*off|\$\d+\s*off|half\s*off|[\d]+\s*percent\s*off)",
    re.IGNORECASE,
)

# Promo code patterns
_RE_PROMO_EXPLICIT = re.compile(
    r"\b(?:code|use|promo)\s+([A-Z][A-Z0-9]{2,})\b",
    re.IGNORECASE,
)
_RE_PROMO_CONTEXT = re.compile(
    r"\b([A-Z]{3,}[0-9]*)\b"
)
_DISCOUNT_CONTEXT = re.compile(
    r"\b(off|save|discount|sale|percent|%)\b",
    re.IGNORECASE,
)

# Regex patterns (compiled once)
_RE_EMOJI = re.compile(
    "[\U00010000-\U0010FFFF"
    "\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F9FF"
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "]+",
    flags=re.UNICODE,
)
_RE_URL = re.compile(r"https?://\S+|www\.\S+")
_RE_LTK = re.compile(r"liketk\.it/\S+")
_RE_AMAZON = re.compile(r"amazon\.com/\S+|amzn\.to/\S+")


# ---------------------------------------------------------------------------
# Claude CLI helper
# ---------------------------------------------------------------------------

def _call_claude(prompt: str) -> str:
    """Call Claude via CLI subprocess using the Max subscription (no API credits).

    Strips ANTHROPIC_API_KEY from env to avoid 'Invalid API key' errors when
    running inside a `doppler run` context where Doppler injects that key.
    Returns empty string on any failure (timeout, non-zero exit, etc.).
    """
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY",)}
    env["CLAUDECODE"] = ""
    try:
        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True,
            text=True,
            env=env,
            timeout=300,
        )
    except subprocess.TimeoutExpired:
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


# ---------------------------------------------------------------------------
# Pure-Python feature extraction
# ---------------------------------------------------------------------------

def _extract_promo_codes(caption: str) -> list:
    """Extract promo/discount codes from a caption."""
    codes = set()

    # Explicit: "code NICKI", "use SPRING15", "promo SAVE20"
    for m in _RE_PROMO_EXPLICIT.finditer(caption):
        codes.add(m.group(1).upper())

    # Contextual: ALL-CAPS tokens near discount language
    if _DISCOUNT_CONTEXT.search(caption):
        for m in _RE_PROMO_CONTEXT.finditer(caption):
            token = m.group(1)
            # Exclude common non-code all-caps words
            if token not in {"LTK", "IG", "DM", "OK", "AM", "PM", "THE", "AND",
                             "BUT", "FOR", "NOT", "ALL", "NEW", "USE", "GET",
                             "OFF", "NOW", "OUT", "YES", "NO", "SO", "IN", "ON"}:
                codes.add(token)

    return sorted(codes)


def extract_caption_features(caption: str) -> dict:
    """
    Extract structural features from a caption without LLM inference.

    Returns:
        word_count: int
        has_discount_code: bool
        has_price_mention: bool
        has_cta: bool
        has_question: bool
        has_emoji: bool
        emoji_count: int
        hashtag_count: int
        mention_count: int
        urls_mentioned: list[str]
        ltk_links: list[str]
        promo_codes: list[str]
        brand_mentions: list[str]
        discount_amount: str|None
        product_keywords: list[str]
        sentiment: str
    """
    if not caption:
        caption = ""

    # Word count (split on whitespace, ignore empties)
    words = [w for w in caption.split() if w]
    word_count = len(words)

    # Discount code signals
    discount_patterns = re.compile(
        r"\bcode\b|CODE|%\s*off|\d+%|\boff\b", re.IGNORECASE
    )
    has_discount_code = bool(discount_patterns.search(caption))

    # Price mention
    has_price_mention = "$" in caption

    # CTA keywords
    cta_pattern = re.compile(
        r"\b(link|click|shop|swipe|tap)\b", re.IGNORECASE
    )
    has_cta = bool(cta_pattern.search(caption))

    # Question
    stripped = caption.strip()
    has_question = stripped.endswith("?")

    # Emoji
    emoji_matches = _RE_EMOJI.findall(caption)
    emoji_count = len(emoji_matches)
    has_emoji = emoji_count > 0

    # Hashtags and mentions
    hashtags = _RE_HASHTAG.findall(caption)
    mention_handles = _RE_MENTION.findall(caption)
    hashtag_count = len(hashtags)
    mention_count = len(mention_handles)

    # URLs
    urls = _RE_URL.findall(caption)
    ltk_links = _RE_LTK.findall(caption)

    # Promo codes
    promo_codes = _extract_promo_codes(caption)

    # Brand mentions (clean @ off)
    brand_mentions = [h.lower() for h in mention_handles]

    # Discount amount
    dam = DISCOUNT_AMOUNT_PATTERN.search(caption)
    discount_amount = dam.group(0) if dam else None

    # Product keywords (case-insensitive match)
    caption_lower = caption.lower()
    product_kws = [kw for kw in PRODUCT_KEYWORDS if kw in caption_lower]

    # Sentiment: simple rule-based
    caption_words_lower = set(w.strip(".,!?;:'\"") for w in caption.lower().split())
    pos_hits = len(caption_words_lower & POSITIVE_WORDS)
    neg_hits = len(caption_words_lower & NEGATIVE_WORDS)
    exclamation_count = caption.count("!")
    if neg_hits > pos_hits:
        sentiment = "negative"
    elif pos_hits > 0 or exclamation_count >= 1:
        sentiment = "positive"
    else:
        sentiment = "neutral"

    return {
        "word_count": word_count,
        "has_discount_code": has_discount_code,
        "has_price_mention": has_price_mention,
        "has_cta": has_cta,
        "has_question": has_question,
        "has_emoji": has_emoji,
        "emoji_count": emoji_count,
        "hashtag_count": hashtag_count,
        "mention_count": mention_count,
        "urls_mentioned": urls,
        "ltk_links": ltk_links,
        "promo_codes": promo_codes,
        "brand_mentions": brand_mentions,
        "discount_amount": discount_amount,
        "product_keywords": product_kws,
        "sentiment": sentiment,
    }


# ---------------------------------------------------------------------------
# LLM-based batch classification
# ---------------------------------------------------------------------------

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

    # Flatten in order — use `is not None` to preserve legitimately empty batches
    flat: list = []
    for batch_result in ordered_results:
        if batch_result is not None:
            flat.extend(batch_result)
    return flat


# ---------------------------------------------------------------------------
# Word frequency analysis
# ---------------------------------------------------------------------------

def analyze_word_frequency(captions: list, top_n: int = 50) -> dict:
    """
    Count word frequency across all captions.

    - Lowercases everything
    - Removes stop words, single chars, and pure numbers
    - Returns:
        word_frequency: list[{'word': str, 'count': int}] — raw top_n counts
        top_meaningful_words: list[{'word': str, 'count': int}] — after full stop-word filtering
    """
    counter: Counter = Counter()

    for caption in captions:
        if not caption:
            continue
        clean = _RE_URL.sub(" ", caption)
        clean = _RE_MENTION.sub(" ", clean)
        clean = _RE_HASHTAG.sub(" ", clean)
        clean = _RE_EMOJI.sub(" ", clean)
        clean = re.sub(r"[^\w\s']", " ", clean)

        for word in clean.lower().split():
            word = word.strip("'")
            if (
                word
                and len(word) > 1
                and not word.isdigit()
                and word not in STOP_WORDS
            ):
                counter[word] += 1

    # Raw word_frequency (legacy field, top_n results)
    word_frequency = [
        {"word": word, "count": count}
        for word, count in counter.most_common(top_n)
    ]

    # top_meaningful_words: apply a stricter filter — exclude anything that's still
    # in the stop set even after lowercasing, and prefer content-rich terms
    meaningful_counter = Counter({
        word: count
        for word, count in counter.items()
        if word not in STOP_WORDS and len(word) > 2
    })
    top_meaningful_words = [
        {"word": word, "count": count}
        for word, count in meaningful_counter.most_common(top_n)
    ]

    return {
        "word_frequency": word_frequency,
        "top_meaningful_words": top_meaningful_words,
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_caption_analysis(data: dict) -> dict:
    """
    Main entry point for caption NLP analysis.

    Input: data dict from load_all_data()

    Returns enriched dicts for each post type plus aggregate stats.
    """
    ig_stories: list = data.get("ig_stories", [])
    ig_reels: list = data.get("ig_reels", [])
    ltk_posts: list = data.get("ltk_posts", [])

    # -----------------------------------------------------------------------
    # 1. Extract features from all captions
    # -----------------------------------------------------------------------

    # IG Stories
    enriched_stories: list = []
    for i, story in enumerate(ig_stories):
        caption = story.get("description") or ""
        features = extract_caption_features(caption)
        enriched = dict(story)
        enriched["caption_features"] = features
        enriched["_classify_id"] = f"story_{i}"
        enriched["_caption"] = caption
        enriched_stories.append(enriched)

    # IG Reels
    enriched_reels: list = []
    for i, reel in enumerate(ig_reels):
        caption = reel.get("description") or ""
        features = extract_caption_features(caption)
        enriched = dict(reel)
        enriched["caption_features"] = features
        enriched["_classify_id"] = f"reel_{i}"
        enriched["_caption"] = caption
        enriched_reels.append(enriched)

    # LTK Posts (feature extraction only — no classification needed)
    enriched_ltk: list = []
    for i, post in enumerate(ltk_posts):
        caption = post.get("description") or ""
        features = extract_caption_features(caption)
        enriched = dict(post)
        enriched["caption_features"] = features
        enriched_ltk.append(enriched)

    # -----------------------------------------------------------------------
    # 2. Classify IG stories + reels via Claude (batch)
    # -----------------------------------------------------------------------

    story_payloads = [
        {"id": s["_classify_id"], "caption": s["_caption"], "platform": "ig_story"}
        for s in enriched_stories
        if s["_caption"].strip()
    ]
    reel_payloads = [
        {"id": r["_classify_id"], "caption": r["_caption"], "platform": "ig_reel"}
        for r in enriched_reels
        if r["_caption"].strip()
    ]

    all_payloads = story_payloads + reel_payloads
    classified = classify_caption_batch(all_payloads, batch_size=20)

    # Build lookup by _classify_id
    clf_lookup: dict = {item["id"]: item for item in classified}

    # Classification fields to merge
    _clf_fields = [
        "intent", "seasonal_tag", "tone", "key_topics",
        "product_category", "hook_type", "has_urgency", "virality_signals",
    ]
    _clf_defaults = {
        "intent": None, "seasonal_tag": None, "tone": None, "key_topics": [],
        "product_category": None, "hook_type": None, "has_urgency": False,
        "virality_signals": [],
    }

    # Merge classification back into enriched stories
    for story in enriched_stories:
        clf = clf_lookup.get(story["_classify_id"], {})
        for field in _clf_fields:
            story[field] = clf.get(field, _clf_defaults[field])
        del story["_classify_id"]
        del story["_caption"]

    # Merge classification back into enriched reels
    for reel in enriched_reels:
        clf = clf_lookup.get(reel["_classify_id"], {})
        for field in _clf_fields:
            reel[field] = clf.get(field, _clf_defaults[field])
        del reel["_classify_id"]
        del reel["_caption"]

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

    # -----------------------------------------------------------------------
    # 3. Word frequency across all captions
    # -----------------------------------------------------------------------

    all_captions = (
        [s.get("description") or "" for s in ig_stories]
        + [r.get("description") or "" for r in ig_reels]
        + [p.get("description") or "" for p in ltk_posts]
    )
    word_freq_result = analyze_word_frequency(all_captions, top_n=50)
    word_frequency = word_freq_result["word_frequency"]
    top_meaningful_words = word_freq_result["top_meaningful_words"]

    # -----------------------------------------------------------------------
    # 4. Aggregate stats
    # -----------------------------------------------------------------------

    intent_counter: Counter = Counter()
    seasonal_counter: Counter = Counter()
    product_category_counter: Counter = Counter()
    hook_type_counter: Counter = Counter()

    for item in enriched_stories + enriched_reels:
        if item.get("intent"):
            intent_counter[item["intent"]] += 1
        if item.get("seasonal_tag"):
            seasonal_counter[item["seasonal_tag"]] += 1
        if item.get("product_category"):
            product_category_counter[item["product_category"]] += 1
        if item.get("hook_type"):
            hook_type_counter[item["hook_type"]] += 1

    def _avg_words(items: list) -> float:
        lengths = [
            item["caption_features"]["word_count"]
            for item in items
            if item.get("caption_features")
        ]
        return sum(lengths) / len(lengths) if lengths else 0.0

    def _pct(items: list, feature_key: str) -> float:
        if not items:
            return 0.0
        matching = sum(
            1 for item in items
            if item.get("caption_features", {}).get(feature_key, False)
        )
        return round(matching / len(items) * 100, 1)

    all_ig = enriched_stories + enriched_reels
    total_analyzed = len(all_ig) + len(enriched_ltk)

    stats = {
        "avg_caption_length_stories": round(_avg_words(enriched_stories), 1),
        "avg_caption_length_reels": round(_avg_words(enriched_reels), 1),
        "pct_with_cta": _pct(all_ig, "has_cta"),
        "pct_with_discount_code": _pct(all_ig, "has_discount_code"),
        "total_analyzed": total_analyzed,
    }

    # -----------------------------------------------------------------------
    # 5. Promo code & brand mention aggregations
    # -----------------------------------------------------------------------

    promo_code_counter: Counter = Counter()
    brand_mention_counter: Counter = Counter()

    for item in enriched_stories + enriched_reels + enriched_ltk:
        features = item.get("caption_features", {})
        for code in features.get("promo_codes", []):
            promo_code_counter[code] += 1
        for brand in features.get("brand_mentions", []):
            brand_mention_counter[brand] += 1

    top_promo_codes = [
        {"code": code, "count": count}
        for code, count in promo_code_counter.most_common(20)
    ]
    top_brand_mentions = [
        {"brand": brand, "count": count}
        for brand, count in brand_mention_counter.most_common(20)
    ]

    # -----------------------------------------------------------------------
    # 6. Engagement by intent
    # -----------------------------------------------------------------------

    intent_engagement: dict = {}
    for item in enriched_stories + enriched_reels:
        intent = item.get("intent")
        if not intent:
            continue
        if intent not in intent_engagement:
            intent_engagement[intent] = {"views_sum": 0, "link_clicks_sum": 0, "count": 0}
        intent_engagement[intent]["views_sum"] += item.get("views") or 0
        intent_engagement[intent]["link_clicks_sum"] += item.get("link_clicks") or 0
        intent_engagement[intent]["count"] += 1

    engagement_by_intent = {}
    for intent, d in intent_engagement.items():
        n = d["count"]
        engagement_by_intent[intent] = {
            "avg_views": round(d["views_sum"] / n, 1) if n else 0.0,
            "avg_link_clicks": round(d["link_clicks_sum"] / n, 1) if n else 0.0,
            "count": n,
        }

    # -----------------------------------------------------------------------
    # 7. High-performing captions (top 10 by views)
    # -----------------------------------------------------------------------

    candidates = []
    for item in enriched_stories:
        views = item.get("views") or 0
        caption_text = item.get("description") or ""
        if caption_text.strip():
            candidates.append({
                "caption": caption_text[:200],
                "platform": "ig_story",
                "views": views,
                "intent": item.get("intent"),
                "hook_type": item.get("hook_type"),
            })
    for item in enriched_reels:
        views = item.get("views") or 0
        caption_text = item.get("description") or ""
        if caption_text.strip():
            candidates.append({
                "caption": caption_text[:200],
                "platform": "ig_reel",
                "views": views,
                "intent": item.get("intent"),
                "hook_type": item.get("hook_type"),
            })

    candidates.sort(key=lambda x: x["views"], reverse=True)
    high_performing_captions = candidates[:10]

    # -----------------------------------------------------------------------
    # 8. Caption length vs. performance
    # -----------------------------------------------------------------------

    length_buckets: dict = {
        "short": {"views_sum": 0, "count": 0},   # < 50 chars
        "medium": {"views_sum": 0, "count": 0},  # 50-150 chars
        "long": {"views_sum": 0, "count": 0},    # > 150 chars
    }

    for item in enriched_stories + enriched_reels:
        caption_text = item.get("description") or ""
        char_len = len(caption_text)
        views = item.get("views") or 0
        if char_len < 50:
            bucket = "short"
        elif char_len <= 150:
            bucket = "medium"
        else:
            bucket = "long"
        length_buckets[bucket]["views_sum"] += views
        length_buckets[bucket]["count"] += 1

    caption_length_performance = {}
    for bucket, d in length_buckets.items():
        n = d["count"]
        caption_length_performance[bucket] = {
            "avg_views": round(d["views_sum"] / n, 1) if n else 0.0,
            "count": n,
        }

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

    return {
        "ig_stories": enriched_stories,
        "ig_reels": enriched_reels,
        "ltk_posts": enriched_ltk,
        "word_frequency": word_frequency,
        "top_meaningful_words": top_meaningful_words,
        "intent_distribution": dict(intent_counter),
        "seasonal_distribution": dict(seasonal_counter),
        "product_category_distribution": dict(product_category_counter),
        "hook_type_distribution": dict(hook_type_counter),
        "top_promo_codes": top_promo_codes,
        "top_brand_mentions": top_brand_mentions,
        "engagement_by_intent": engagement_by_intent,
        "high_performing_captions": high_performing_captions,
        "caption_length_performance": caption_length_performance,
        "stats": stats,
        "avg_seo_score":          avg_seo_score,
        "seo_score_distribution": seo_dist,
        "seo_top_issues":         seo_top_issues,
        "seo_prescriptions":      seo_prescriptions,
    }
