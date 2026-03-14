"""
test_caption_nlp.py — Tests for the caption_nlp module.

Tests:
1. extract_caption_features with 3 sample captions
2. analyze_word_frequency with 10 sample captions
3. classify_caption_batch with 5 real IG story captions from the CSV
"""

import csv
import json
import sys
import os

# Ensure the modules directory is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from modules.caption_nlp import (
    extract_caption_features,
    analyze_word_frequency,
    classify_caption_batch,
)

STORIES_CSV = os.path.expanduser(
    "~/Downloads/Mar-01-2025_May-31-2025_1876201469692602.csv"
)


# ---------------------------------------------------------------------------
# Test 1 — extract_caption_features
# ---------------------------------------------------------------------------

def test_extract_caption_features():
    print("\n" + "=" * 60)
    print("TEST 1: extract_caption_features")
    print("=" * 60)

    samples = [
        (
            "sale_heavy",
            "Code NICKI saves you 20% OFF 🎉 Click the link in bio to shop now! "
            "#spring #sale @myhumehealth Check out liketk.it/abc123",
        ),
        (
            "lifestyle_story",
            "Just got back from the most amazing brunch with my girls ☀️ "
            "Obsessed with this fit — totally feeling the spring vibes. "
            "What's your go-to spring outfit?",
        ),
        (
            "empty_caption",
            "",
        ),
    ]

    for label, caption in samples:
        features = extract_caption_features(caption)
        print(f"\n  Caption ({label}):")
        print(f"    Text: {repr(caption[:80])}{'...' if len(caption) > 80 else ''}")
        for key, val in features.items():
            print(f"    {key}: {val}")

    # Spot-check assertions
    sale_features = extract_caption_features(samples[0][1])
    assert sale_features["has_discount_code"], "Expected discount code detected"
    assert sale_features["has_cta"], "Expected CTA detected"
    assert sale_features["has_emoji"], "Expected emoji detected"
    assert sale_features["hashtag_count"] == 2, f"Expected 2 hashtags, got {sale_features['hashtag_count']}"
    assert sale_features["mention_count"] == 1, f"Expected 1 mention, got {sale_features['mention_count']}"
    assert len(sale_features["ltk_links"]) == 1, "Expected 1 LTK link"
    # New fields
    assert "NICKI" in sale_features["promo_codes"], f"Expected NICKI in promo_codes, got {sale_features['promo_codes']}"
    assert "myhumehealth" in sale_features["brand_mentions"], f"Expected brand mention, got {sale_features['brand_mentions']}"
    assert sale_features["discount_amount"] is not None, "Expected discount amount detected"
    assert sale_features["sentiment"] == "positive", f"Expected positive sentiment, got {sale_features['sentiment']}"

    lifestyle_features = extract_caption_features(samples[1][1])
    assert lifestyle_features["has_question"], "Expected question detected"
    assert not lifestyle_features["has_discount_code"], "Should not detect discount code"
    assert lifestyle_features["sentiment"] in ("positive", "neutral"), "Lifestyle should be positive or neutral"

    empty_features = extract_caption_features(samples[2][1])
    assert empty_features["word_count"] == 0, "Empty caption should have 0 words"
    assert not empty_features["has_emoji"]
    assert empty_features["promo_codes"] == [], "Empty caption should have no promo codes"
    assert empty_features["product_keywords"] == [], "Empty caption should have no product keywords"

    print("\n  ✓ All extract_caption_features assertions passed.")


# ---------------------------------------------------------------------------
# Test 2 — analyze_word_frequency
# ---------------------------------------------------------------------------

def test_analyze_word_frequency():
    print("\n" + "=" * 60)
    print("TEST 2: analyze_word_frequency")
    print("=" * 60)

    sample_captions = [
        "Love this spring outfit! Shop the link in bio.",
        "Spring sale is here! Use code NICKI for 20% off your order.",
        "Feeling so good in these new arrivals. Spring vibes only.",
        "New denim just dropped — obsessed! Shop my LTK for details.",
        "Easter basket ideas for the whole family. So many good finds!",
        "Morning routine featuring my favorite skincare picks. Shop now!",
        "Transitioning my wardrobe from winter to spring — here's what I'm loving.",
        "Sale alert! These denim jeans are 40% off today only. Code NICKI.",
        "Sharing my honest review of this supplement. Code NICKI saves you money.",
        "Spring cleaning haul — everything is linked on LTK. Happy shopping!",
    ]

    freq_result = analyze_word_frequency(sample_captions, top_n=20)
    freq = freq_result["word_frequency"]
    top_meaningful = freq_result["top_meaningful_words"]

    print(f"\n  Top {len(freq)} words (raw) across 10 captions:")
    for entry in freq:
        print(f"    {entry['word']:20s}  {entry['count']}")

    print(f"\n  Top {len(top_meaningful)} meaningful words:")
    for entry in top_meaningful[:10]:
        print(f"    {entry['word']:20s}  {entry['count']}")

    assert len(freq) <= 20, "Should return at most 20 words"
    assert all("word" in e and "count" in e for e in freq), "Each entry needs word and count"
    assert "word_frequency" in freq_result, "Result should have word_frequency key"
    assert "top_meaningful_words" in freq_result, "Result should have top_meaningful_words key"

    words_returned = [e["word"] for e in freq]
    assert "the" not in words_returned, "'the' is a stop word and should be excluded"
    assert "a" not in words_returned, "'a' is a stop word and should be excluded"
    # New: filler words should also be excluded
    assert "lol" not in words_returned, "'lol' is an Instagram filler word and should be excluded"
    assert "omg" not in words_returned, "'omg' should be excluded"

    # Verify sorted descending
    counts = [e["count"] for e in freq]
    assert counts == sorted(counts, reverse=True), "Results should be sorted by count desc"

    print("\n  ✓ All analyze_word_frequency assertions passed.")


# ---------------------------------------------------------------------------
# Test 3 — classify_caption_batch with real IG captions
# ---------------------------------------------------------------------------

def load_real_captions(csv_path: str, n: int = 5) -> list[dict]:
    """Read first n rows with non-empty descriptions from the IG stories CSV."""
    rows = []
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Column might be 'Description' with original casing
            desc = row.get("Description") or row.get("description") or ""
            if desc.strip():
                rows.append({
                    "id": row.get("Post ID") or row.get("post_id") or str(len(rows)),
                    "caption": desc.strip(),
                    "platform": "ig_story",
                })
            if len(rows) >= n:
                break
    return rows


def test_classify_caption_batch():
    print("\n" + "=" * 60)
    print("TEST 3: classify_caption_batch (real IG story captions)")
    print("=" * 60)

    if not os.path.exists(STORIES_CSV):
        print(f"\n  SKIP: CSV not found at {STORIES_CSV}")
        return

    real_captions = load_real_captions(STORIES_CSV, n=5)
    print(f"\n  Loaded {len(real_captions)} real captions from CSV.")

    print("\n  --- Input captions ---")
    for item in real_captions:
        print(f"  [{item['id']}] {repr(item['caption'][:100])}{'...' if len(item['caption']) > 100 else ''}")

    print("\n  Calling Claude for classification (may take ~10s)...")
    classified = classify_caption_batch(real_captions, batch_size=5)

    print("\n  --- Classification results ---")
    for item in classified:
        print(f"\n  ID: {item['id']}")
        print(f"    Caption:          {repr(item['caption'][:80])}...")
        print(f"    Intent:           {item.get('intent')}")
        print(f"    Seasonal tag:     {item.get('seasonal_tag')}")
        print(f"    Tone:             {item.get('tone')}")
        print(f"    Key topics:       {item.get('key_topics')}")
        print(f"    Product category: {item.get('product_category')}")
        print(f"    Hook type:        {item.get('hook_type')}")
        print(f"    Has urgency:      {item.get('has_urgency')}")
        print(f"    Virality signals: {item.get('virality_signals')}")

    # Assertions
    assert len(classified) == len(real_captions), (
        f"Output count {len(classified)} != input count {len(real_captions)}"
    )
    for item in classified:
        assert "intent" in item, "Each result should have 'intent'"
        assert "seasonal_tag" in item, "Each result should have 'seasonal_tag'"
        assert "tone" in item, "Each result should have 'tone'"
        assert "key_topics" in item, "Each result should have 'key_topics'"
        assert "product_category" in item, "Each result should have 'product_category'"
        assert "hook_type" in item, "Each result should have 'hook_type'"
        assert "has_urgency" in item, "Each result should have 'has_urgency'"
        assert "virality_signals" in item, "Each result should have 'virality_signals'"

    print("\n  ✓ classify_caption_batch completed successfully.")


# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Running caption_nlp tests...")

    test_extract_caption_features()
    test_analyze_word_frequency()
    test_classify_caption_batch()

    print("\n" + "=" * 60)
    print("ALL TESTS PASSED")
    print("=" * 60)
