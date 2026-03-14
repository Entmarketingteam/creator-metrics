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
_RE_HASHTAG = re.compile(r"#\w+")
_RE_MENTION = re.compile(r"@(\w+)")
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

def classify_caption_batch(captions: list, batch_size: int = 20) -> list:
    """
    Classify captions using Claude CLI in batches.

    Each input dict must have: {'id': str, 'caption': str, 'platform': str}
    Adds classification fields to each dict.
    Returns the enriched list (same order as input).
    """
    if not captions:
        return []

    results: list = []

    for batch_start in range(0, len(captions), batch_size):
        batch = captions[batch_start : batch_start + batch_size]

        # Truncate captions to keep token count manageable per batch
        payload = [
            {"id": item["id"], "caption": (item.get("caption") or "")[:200]}
            for item in batch
        ]
        captions_json = json.dumps(payload, ensure_ascii=False)

        total_batches = (len(captions) + batch_size - 1) // batch_size
        current_batch = batch_start // batch_size + 1
        print(f"    Classifying batch {current_batch}/{total_batches} ({len(batch)} captions)...")

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

        # Parse Claude response
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

        # Build lookup by id for safe merging
        class_by_id: dict = {}
        for c in classifications:
            if isinstance(c, dict) and "id" in c:
                class_by_id[str(c["id"])] = c

        for item in batch:
            merged = dict(item)
            clf = class_by_id.get(str(item["id"]), {})
            merged["intent"] = clf.get("intent") or None
            merged["seasonal_tag"] = clf.get("seasonal_tag") or None
            merged["tone"] = clf.get("tone") or None
            merged["key_topics"] = clf.get("key_topics") or []
            merged["product_category"] = clf.get("product_category") or None
            merged["hook_type"] = clf.get("hook_type") or None
            merged["has_urgency"] = clf.get("has_urgency") or False
            merged["virality_signals"] = clf.get("virality_signals") or []
            results.append(merged)

    return results


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
    }
