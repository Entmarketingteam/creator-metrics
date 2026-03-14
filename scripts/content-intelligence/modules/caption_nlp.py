"""
caption_nlp.py — NLP helpers for Instagram caption analysis.

Handles: text feature extraction, promo-code detection, keyword classification,
sentiment scoring, and SEO scoring (IG July 2025 Google-indexing update).
"""

from __future__ import annotations

import re
from typing import Optional

# ---------------------------------------------------------------------------
# Compiled regex primitives
# ---------------------------------------------------------------------------

_RE_HASHTAG = re.compile(r"#\w+")
_RE_MENTION = re.compile(r"@\w+")
_RE_EMOJI   = re.compile(
    "[\U00010000-\U0010ffff"
    "\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F1E0-\U0001F1FF"
    "]+",
    flags=re.UNICODE,
)
_RE_URL = re.compile(r"https?://\S+|www\.\S+")
_RE_PROMO_CODE = re.compile(
    r"\b([A-Z]{2,10}\d{0,4}|[A-Z]{2,}\d{2,})\b"
)

# ---------------------------------------------------------------------------
# Stop-words (English common + IG filler)
# ---------------------------------------------------------------------------

STOP_WORDS = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "up", "about", "into", "through", "during",
    "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can",
    "i", "me", "my", "myself", "we", "our", "you", "your", "he", "she",
    "it", "they", "them", "their", "this", "that", "these", "those",
    "so", "just", "very", "really", "like", "also", "too", "more", "most",
    "new", "get", "got", "use", "used", "one", "two", "all", "any",
    "not", "no", "nor", "same", "such", "own",
    # IG filler
    "ad", "sp", "gifted", "c/o", "collab",
}

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


# ---------------------------------------------------------------------------
# Promo-code extraction
# ---------------------------------------------------------------------------

def _extract_promo_codes(text: str) -> list[str]:
    """Return list of likely promo/discount codes found in *text*."""
    # Strip hashtags/mentions first so we don't pick up tags
    cleaned = _RE_HASHTAG.sub("", _RE_MENTION.sub("", text))
    return _RE_PROMO_CODE.findall(cleaned)


# ---------------------------------------------------------------------------
# Basic feature extraction
# ---------------------------------------------------------------------------

def extract_features(caption: str) -> dict:
    """
    Extract structured features from a raw caption string.

    Returns a dict with counts and lists for downstream scoring.
    """
    if not caption:
        return {
            "char_count": 0,
            "word_count": 0,
            "hashtag_count": 0,
            "hashtags": [],
            "mention_count": 0,
            "mentions": [],
            "emoji_count": 0,
            "has_url": False,
            "promo_codes": [],
            "hook_text": "",
        }

    hashtags   = _RE_HASHTAG.findall(caption)
    mentions   = _RE_MENTION.findall(caption)
    emojis     = _RE_EMOJI.findall(caption)
    promo_codes = _extract_promo_codes(caption)
    has_url    = bool(_RE_URL.search(caption))
    words      = caption.split()

    return {
        "char_count":    len(caption),
        "word_count":    len(words),
        "hashtag_count": len(hashtags),
        "hashtags":      hashtags,
        "mention_count": len(mentions),
        "mentions":      mentions,
        "emoji_count":   sum(len(e) for e in emojis),
        "has_url":       has_url,
        "promo_codes":   promo_codes,
        "hook_text":     caption[:125],
    }
