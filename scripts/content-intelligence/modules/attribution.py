"""
Attribution module for content intelligence pipeline.

Matches Instagram Stories and Reels to LTK (affiliate) performance data
to understand which posts drove affiliate revenue for creator Nicki Entenmann.

Match types (in priority order):
  1. URL match   — IG post description contains the liketk.it short code  (confidence 1.0)
  2. Date match  — IG and LTK posts published within a configurable time window (conf 0.5-0.9)
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_utc(dt: datetime) -> datetime:
    """Ensure a datetime is UTC-aware. Naive datetimes are assumed UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _hours_apart(a: datetime, b: datetime) -> float:
    """Return absolute difference in hours between two datetimes."""
    return abs((_to_utc(a) - _to_utc(b)).total_seconds()) / 3600.0


# ---------------------------------------------------------------------------
# 1. URL-based matching
# ---------------------------------------------------------------------------

_LTK_URL_RE = re.compile(
    r"(?:https?://)?liketk\.it/([A-Za-z0-9_\-]+)",
    re.IGNORECASE,
)


def extract_ltk_codes_from_text(text: str) -> list[str]:
    """Extract liketk.it short codes from caption text.

    Matches all of:
      - https://liketk.it/XXXXX
      - http://liketk.it/XXXXX
      - liketk.it/XXXXX

    Returns a list of short codes (the XXXXX part only).
    """
    if not text:
        return []
    return _LTK_URL_RE.findall(text)


def _ltk_code_from_share_url(share_url: str) -> str | None:
    """Pull the short code out of an LTK share_url like https://liketk.it/5e3rP."""
    if not share_url:
        return None
    codes = extract_ltk_codes_from_text(share_url)
    return codes[0] if codes else None


def match_by_url(
    ig_posts: list[dict[str, Any]],
    ltk_posts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Match IG posts to LTK posts via liketk.it URL in the post description.

    A single IG post can match multiple LTK posts (carousel with multiple links).
    An LTK post can appear in multiple IG posts (reshared across days).

    Returns a list of match dicts:
        {
            'ig_post':    dict,
            'ltk_post':   dict,
            'match_type': 'url',
            'confidence': 1.0,
        }
    """
    # Build lookup: short_code -> ltk_post (one LTK post per code)
    ltk_by_code: dict[str, dict] = {}
    for ltk in ltk_posts:
        code = _ltk_code_from_share_url(ltk.get("share_url", ""))
        if code:
            ltk_by_code[code] = ltk

    matches: list[dict[str, Any]] = []

    for ig in ig_posts:
        description = ig.get("description", "") or ""
        codes = extract_ltk_codes_from_text(description)
        for code in codes:
            ltk = ltk_by_code.get(code)
            if ltk is not None:
                matches.append(
                    {
                        "ig_post": ig,
                        "ltk_post": ltk,
                        "match_type": "url",
                        "confidence": 1.0,
                    }
                )

    return matches


# ---------------------------------------------------------------------------
# 2. Date-based matching
# ---------------------------------------------------------------------------

def _date_confidence(hours: float) -> float:
    """Map time-delta (hours) to a confidence score."""
    if hours < 2:
        return 0.9
    if hours < 6:
        return 0.7
    return 0.5  # anything up to window_hours


def match_by_date(
    ig_posts: list[dict[str, Any]],
    ltk_posts: list[dict[str, Any]],
    window_hours: int = 24,
    already_matched_pairs: set[tuple[str, str]] | None = None,
) -> list[dict[str, Any]]:
    """Match IG stories/reels to LTK posts published within window_hours of each other.

    Filtering rules:
      - Stories : only considered if sticker_taps > 0 OR link_clicks > 0
      - Reels   : only considered if within 12 hours of an LTK post

    already_matched_pairs: set of (ig_post_id, ltk_share_url) tuples already
      matched by URL matching — skipped to prevent double-matching.

    Confidence tiers:
      < 2 h  -> 0.9
      < 6 h  -> 0.7
      < 24 h -> 0.5
    """
    already_matched_pairs = already_matched_pairs or set()

    def _is_story(ig: dict) -> bool:
        # Stories have 'sticker_taps' or 'navigation' fields; reels have 'saves'/'shares'
        return "sticker_taps" in ig or "navigation" in ig

    def _has_link(ig: dict) -> bool:
        return (ig.get("sticker_taps") or 0) > 0 or (ig.get("link_clicks") or 0) > 0

    matches: list[dict[str, Any]] = []

    for ig in ig_posts:
        ig_id = ig.get("post_id", "")
        is_story = _is_story(ig)

        # Stories without a link sticker are skipped
        if is_story and not _has_link(ig):
            continue

        ig_time = ig.get("publish_time")
        if ig_time is None:
            continue

        # Reels use a tighter window (12 h instead of window_hours)
        effective_window = 12 if not is_story else window_hours

        for ltk in ltk_posts:
            ltk_url = ltk.get("share_url", "")
            pair_key = (ig_id, ltk_url)

            # Skip pairs already captured by URL matching
            if pair_key in already_matched_pairs:
                continue

            ltk_time = ltk.get("date_published")
            if ltk_time is None:
                continue

            hours = _hours_apart(ig_time, ltk_time)
            if hours <= effective_window:
                matches.append(
                    {
                        "ig_post": ig,
                        "ltk_post": ltk,
                        "match_type": "date",
                        "confidence": _date_confidence(hours),
                    }
                )

    return matches


# ---------------------------------------------------------------------------
# 3. Main attribution function
# ---------------------------------------------------------------------------

def build_attribution_map(data: dict[str, Any]) -> dict[str, Any]:
    """Build a complete attribution map from ingested content data.

    Input  : the data dict returned by load_all_data(), expected keys:
               'ltk_posts', 'ig_stories', 'ig_reels'

    Returns:
        {
            'matches'       : list of enriched match dicts,
            'unmatched_ltk' : LTK posts with no IG match,
            'unmatched_ig'  : IG posts with no LTK match,
            'stats'         : summary statistics dict,
        }

    Each match dict:
        {
            'ig_post':                 dict,
            'ltk_post':                dict,
            'match_type':              'url' | 'date',
            'confidence':              float,
            'attributed_commissions':  float,
            'attributed_clicks':       int,
        }
    """
    ltk_posts: list[dict] = data.get("ltk_posts", [])
    ig_stories: list[dict] = data.get("ig_stories", [])
    ig_reels: list[dict] = data.get("ig_reels", [])
    all_ig: list[dict] = ig_stories + ig_reels

    # ---- Step 1: URL matches (highest confidence, first priority) ----------
    url_matches = match_by_url(all_ig, ltk_posts)

    # Track which pairs are already matched to prevent double-counting
    already_matched: set[tuple[str, str]] = set()
    for m in url_matches:
        ig_id = m["ig_post"].get("post_id", "")
        ltk_url = m["ltk_post"].get("share_url", "")
        already_matched.add((ig_id, ltk_url))

    # ---- Step 2: Date matches (for everything not already URL-matched) -----
    date_matches = match_by_date(
        all_ig, ltk_posts, window_hours=24, already_matched_pairs=already_matched
    )

    all_matches = url_matches + date_matches

    # ---- Step 3: Enrich matches with attributed metrics --------------------
    enriched: list[dict[str, Any]] = []
    for m in all_matches:
        ltk = m["ltk_post"]
        enriched.append(
            {
                **m,
                "attributed_commissions": float(ltk.get("commissions", 0.0)),
                "attributed_clicks": int(ltk.get("clicks", 0)),
            }
        )

    # ---- Step 4: Compute unmatched sets ------------------------------------
    # LTK posts that appear in at least one match
    matched_ltk_urls: set[str] = {
        m["ltk_post"].get("share_url", "") for m in enriched
    }
    unmatched_ltk = [
        ltk for ltk in ltk_posts
        if ltk.get("share_url", "") not in matched_ltk_urls
    ]

    # IG posts that appear in at least one match
    matched_ig_ids: set[str] = {
        m["ig_post"].get("post_id", "") for m in enriched
    }
    unmatched_ig = [
        ig for ig in all_ig
        if ig.get("post_id", "") not in matched_ig_ids
    ]

    # ---- Step 5: Stats ------------------------------------------------------
    total_ltk_commissions = sum(float(p.get("commissions", 0.0)) for p in ltk_posts)

    # Attribution rate: based on unique LTK posts matched (not sum of all match rows)
    matched_ltk_commissions = sum(
        float(p.get("commissions", 0.0)) for p in ltk_posts
        if p.get("share_url", "") in matched_ltk_urls
    )
    attribution_rate = (
        matched_ltk_commissions / total_ltk_commissions
        if total_ltk_commissions > 0
        else 0.0
    )

    # Total attributed commissions — sum from UNIQUE matched LTK posts only
    # (avoids double-counting when one LTK post matches multiple IG posts)
    total_attributed = matched_ltk_commissions

    stats: dict[str, Any] = {
        "total_ltk_posts": len(ltk_posts),
        "total_ig_stories": len(ig_stories),
        "total_ig_reels": len(ig_reels),
        "matched_url": len(url_matches),
        "matched_date": len(date_matches),
        "unmatched": len(unmatched_ltk),
        "total_attributed_commissions": round(total_attributed, 2),
        "attribution_rate": round(attribution_rate, 4),
    }

    return {
        "matches": enriched,
        "unmatched_ltk": unmatched_ltk,
        "unmatched_ig": unmatched_ig,
        "stats": stats,
    }
