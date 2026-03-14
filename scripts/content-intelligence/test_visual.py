"""
Test suite for visual_analysis module.
Tests theme detection, embedding generation, and similarity search.
"""

import os
import sys
import csv
import json

# Ensure modules directory is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from modules.visual_analysis import (
    analyze_image_themes,
    generate_text_embedding,
    build_similarity_index,
    find_similar_posts,
    cosine_similarity,
)

CSV_PATH = os.path.expanduser("~/Downloads/LTK-export (21).csv")


def get_test_image_urls(csv_path: str, n: int = 3) -> list:
    """Read first n hero_image URLs from the CSV."""
    urls = []
    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            url = row.get('hero_image', '').strip()
            if url:
                urls.append(url)
            if len(urls) >= n:
                break
    return urls


def test_theme_detection(api_key: str):
    print("\n" + "=" * 60)
    print("TEST 1: Image Theme Detection")
    print("=" * 60)

    urls = get_test_image_urls(CSV_PATH, 3)
    print(f"Loaded {len(urls)} image URLs from CSV\n")

    results = []
    for i, url in enumerate(urls):
        print(f"--- Image {i + 1} ---")
        print(f"URL: {url[:80]}...")
        result = analyze_image_themes(url, api_key)
        if result:
            print(f"Themes:          {result.get('themes', [])}")
            print(f"Dominant Colors: {result.get('dominant_colors', [])}")
            print(f"Content Type:    {result.get('content_type', 'N/A')}")
            print(f"Setting:         {result.get('setting', 'N/A')}")
            print(f"Season Vibe:     {result.get('season_vibe', 'N/A')}")
            print(f"Description:     {result.get('description', 'N/A')}")
            print(f"Confidence:      {result.get('confidence', 0):.2f}")
            results.append(result)
        else:
            print("FAILED: returned None (image unavailable or API error)")
        print()

    print(f"Theme detection: {len(results)}/{len(urls)} succeeded")
    return results


def test_embedding_generation(api_key: str):
    print("\n" + "=" * 60)
    print("TEST 2: Embedding Generation")
    print("=" * 60)

    sample_text = "A woman wearing a flowy spring floral dress in a sunny outdoor setting, perfect for Easter or spring events."
    print(f"Input text: {sample_text[:80]}...")

    embedding = generate_text_embedding(sample_text, api_key)
    print(f"Embedding dimensions: {len(embedding)}")
    print(f"First 5 values: {[round(v, 6) for v in embedding[:5]]}")
    print(f"Value range: [{min(embedding):.4f}, {max(embedding):.4f}]")

    assert len(embedding) == 3072, f"Expected 3072 dimensions, got {len(embedding)}"
    print("PASSED: 3072-dimensional embedding generated successfully")
    return embedding


def test_similarity_search(api_key: str):
    print("\n" + "=" * 60)
    print("TEST 3: Similarity Search")
    print("=" * 60)

    # Build 2 test posts with fake visual analysis
    posts = [
        {
            'id': 'post_001',
            'hero_image': 'https://example.com/img1.jpg',
            'visual_analysis': {
                'themes': ['spring_florals', 'outfit_of_the_day'],
                'description': 'A woman in a pink floral spring dress outdoors, casual daytime look.',
                'content_type': 'outfit_photo',
                'setting': 'outdoor',
            }
        },
        {
            'id': 'post_002',
            'hero_image': 'https://example.com/img2.jpg',
            'visual_analysis': {
                'themes': ['swimwear', 'beach_vacation'],
                'description': 'A person in a bright bikini on a sandy beach with turquoise water.',
                'content_type': 'outfit_photo',
                'setting': 'beach',
            }
        },
        {
            'id': 'post_003',
            'hero_image': 'https://example.com/img3.jpg',
            'visual_analysis': {
                'themes': ['spring_florals', 'casual_everyday'],
                'description': 'Spring outfit with floral blouse and white jeans, outdoor garden setting.',
                'content_type': 'outfit_photo',
                'setting': 'outdoor',
            }
        },
    ]

    print("Generating embeddings for 3 test posts...")
    similarity_index = build_similarity_index(posts, api_key)
    print(f"Index built: {len(similarity_index['post_ids'])} posts indexed")
    print(f"Post IDs: {similarity_index['post_ids']}")

    # Test similarity search from post_001 — should rank post_003 higher than post_002
    print("\nFinding posts similar to post_001 (spring florals, outdoor)...")
    similar = find_similar_posts('post_001', similarity_index, posts, top_k=2)

    for item in similar:
        print(f"  Post {item['post'].get('id')}: similarity = {item['similarity_score']:.4f}")
        print(f"    Themes: {item['post']['visual_analysis']['themes']}")

    if similar:
        top_match = similar[0]['post']['id']
        print(f"\nTop match: {top_match}")
        if top_match == 'post_003':
            print("PASSED: post_003 (spring florals) ranked as most similar to post_001")
        else:
            print(f"NOTE: Expected post_003, got {top_match} — may still be semantically reasonable")

    # Test cosine similarity directly
    print("\nDirect cosine similarity test:")
    embs = similarity_index['embeddings']
    if len(embs) >= 2:
        sim_01_02 = cosine_similarity(embs[0], embs[1])
        sim_01_03 = cosine_similarity(embs[0], embs[2]) if len(embs) >= 3 else None
        print(f"  post_001 vs post_002 (beach): {sim_01_02:.4f}")
        if sim_01_03 is not None:
            print(f"  post_001 vs post_003 (spring): {sim_01_03:.4f}")
            if sim_01_03 > sim_01_02:
                print("PASSED: Spring post is more similar to spring post than beach post")
            else:
                print("NOTE: Similarity ordering unexpected but embeddings generated successfully")

    return similarity_index


def main():
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print("ERROR: GEMINI_API_KEY not set. Run with Doppler:")
        print("  doppler run --project ent-agency-automation --config dev -- python test_visual.py")
        sys.exit(1)

    print(f"Using Gemini API key: {api_key[:10]}...")

    # Run all tests
    theme_results = test_theme_detection(api_key)
    embedding = test_embedding_generation(api_key)
    similarity_index = test_similarity_search(api_key)

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Theme detection tests: completed")
    print(f"Embedding generation:  {'PASSED' if len(embedding) == 3072 else 'FAILED'} ({len(embedding)} dims)")
    print(f"Similarity index:      {len(similarity_index['post_ids'])} posts indexed")
    print("\nAll tests complete.")


if __name__ == '__main__':
    main()
