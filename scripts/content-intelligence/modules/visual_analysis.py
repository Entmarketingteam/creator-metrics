"""
Visual Analysis Module
Analyzes creator content images using Gemini 2.5 Flash for theme detection,
embedding generation, and similarity search.

Uses the google-genai SDK (not the deprecated google-generativeai).
Embedding model: models/gemini-embedding-001 (3072 dimensions)
Vision model: gemini-2.5-flash
"""

import json
import sys
import time
import os
import numpy as np
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

from google import genai

VISUAL_THEMES = [
    'swimwear', 'athleisure', 'spring_florals', 'easter_outfit',
    'st_patricks_day', 'summer_dress', 'denim', 'workout_gear',
    'casual_everyday', 'date_night', 'work_outfit', 'accessories',
    'home_decor', 'beauty_makeup', 'shoes', 'kids_fashion',
    'lifestyle_flat_lay', 'outfit_of_the_day', 'try_on_haul',
    'travel_outfit', 'beach_vacation', 'spring_transition'
]

ANALYSIS_PROMPT = """Analyze this image and return a JSON object with the following fields:

- themes: array of up to 3 strings from this exact list that best apply:
  {themes}
- dominant_colors: array of 2-4 color names (e.g. "blush pink", "white", "sage green")
- content_type: one of "outfit_photo", "product_flat_lay", "lifestyle", "selfie", "video_frame"
- setting: one of "indoor", "outdoor", "beach", "gym", "home", "city"
- season_vibe: one of "spring", "summer", "fall", "winter", "transitional"
- description: 1-2 sentence description of the image useful for semantic search
- confidence: float between 0.0 and 1.0 representing your confidence in the analysis

Return ONLY valid JSON, no markdown code blocks, no extra text.""".format(themes=', '.join(VISUAL_THEMES))

# Model constants
VISION_MODEL = 'gemini-2.5-flash'
EMBEDDING_MODEL = 'models/gemini-embedding-001'
EMBEDDING_DIMS = 3072


def cosine_similarity(a: list, b: list) -> float:
    a, b = np.array(a), np.array(b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def _get_client(api_key: str) -> genai.Client:
    return genai.Client(api_key=api_key)


def _fetch_image(image_url: str) -> Optional[tuple]:
    """
    Fetch image bytes from URL. Returns (bytes, mime_type) or None on failure.
    """
    try:
        req = urllib.request.Request(
            image_url,
            headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            image_bytes = resp.read()
            ct = resp.headers.get('Content-Type', 'image/jpeg').split(';')[0].strip()
            if 'jpeg' in ct or 'jpg' in ct:
                mime_type = 'image/jpeg'
            elif 'png' in ct:
                mime_type = 'image/png'
            elif 'webp' in ct:
                mime_type = 'image/webp'
            elif 'gif' in ct:
                mime_type = 'image/gif'
            else:
                mime_type = 'image/jpeg'
            return image_bytes, mime_type
    except (urllib.error.URLError, urllib.error.HTTPError, Exception) as e:
        print(f"  Image fetch failed: {e}")
        return None


def analyze_image_themes(image_url: str, api_key: str) -> Optional[dict]:
    """
    Use Gemini 2.5 Flash to analyze an image URL and return visual theme data.

    Returns dict with keys:
      themes, dominant_colors, content_type, setting, season_vibe, description, confidence
    Returns None if image fetch fails or API error persists.
    """
    image_data = _fetch_image(image_url)
    if image_data is None:
        return None

    image_bytes, mime_type = image_data
    client = _get_client(api_key)

    max_retries = 3
    for attempt in range(max_retries):
        try:
            from google.genai import types

            response = client.models.generate_content(
                model=VISION_MODEL,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    ANALYSIS_PROMPT
                ]
            )

            raw_text = response.text.strip()

            # Strip markdown code blocks if present
            if raw_text.startswith('```'):
                lines = raw_text.split('\n')
                # Remove first line (```json or ```) and last line (```)
                lines = lines[1:] if len(lines) > 1 else lines
                if lines and lines[-1].strip() == '```':
                    lines = lines[:-1]
                raw_text = '\n'.join(lines).strip()

            result = json.loads(raw_text)

            # Validate themes against allowed list
            if 'themes' in result:
                result['themes'] = [t for t in result['themes'] if t in VISUAL_THEMES][:3]

            # Ensure all expected keys with defaults
            result.setdefault('themes', [])
            result.setdefault('dominant_colors', [])
            result.setdefault('content_type', 'lifestyle')
            result.setdefault('setting', 'indoor')
            result.setdefault('season_vibe', 'transitional')
            result.setdefault('description', '')
            result.setdefault('confidence', 0.5)

            return result

        except Exception as e:
            error_str = str(e)
            if '429' in error_str or 'quota' in error_str.lower() or 'rate' in error_str.lower() or 'RESOURCE_EXHAUSTED' in error_str:
                wait_time = (2 ** attempt) * 5
                print(f"  Rate limited. Waiting {wait_time}s before retry {attempt + 1}/{max_retries}...")
                time.sleep(wait_time)
                continue
            elif attempt < max_retries - 1:
                print(f"  API error (attempt {attempt + 1}): {e}. Retrying...")
                time.sleep(2)
                continue
            else:
                print(f"  Analysis failed after {max_retries} attempts: {e}")
                return None

    return None


def generate_text_embedding(text: str, api_key: str) -> list:
    """
    Generate a 3072-dimensional embedding vector from text using Gemini embedding model.
    Model: models/gemini-embedding-001
    """
    client = _get_client(api_key)

    max_retries = 3
    for attempt in range(max_retries):
        try:
            result = client.models.embed_content(
                model=EMBEDDING_MODEL,
                contents=text
            )
            return list(result.embeddings[0].values)
        except Exception as e:
            error_str = str(e)
            if '429' in error_str or 'quota' in error_str.lower() or 'rate' in error_str.lower() or 'RESOURCE_EXHAUSTED' in error_str:
                wait_time = (2 ** attempt) * 5
                print(f"  Embedding rate limited. Waiting {wait_time}s...")
                time.sleep(wait_time)
                continue
            elif attempt < max_retries - 1:
                print(f"  Embedding error (attempt {attempt + 1}): {e}. Retrying...")
                time.sleep(2)
                continue
            else:
                raise

    raise RuntimeError(f"Failed to generate embedding after {max_retries} attempts")


def build_similarity_index(analyzed_posts: list, api_key: str = None) -> dict:
    """
    Build a similarity index from analyzed posts' descriptions.

    Input: list of posts with 'visual_analysis' field containing 'description'
    Returns: {'embeddings': list[list[float]], 'post_ids': list[str]}
    """
    if api_key is None:
        api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        raise ValueError("api_key required for build_similarity_index")

    embeddings = []
    post_ids = []

    for i, post in enumerate(analyzed_posts):
        va = post.get('visual_analysis')
        if not va:
            continue

        post_id = post.get('id') or post.get('share_url') or str(i)

        # Use cached embedding if available
        if 'embedding' in va and va['embedding']:
            embeddings.append(va['embedding'])
            post_ids.append(post_id)
            continue

        description = va.get('description', '')
        if not description:
            continue

        try:
            embedding = generate_text_embedding(description, api_key)
            embeddings.append(embedding)
            post_ids.append(post_id)
            # Light rate limit for embedding calls
            time.sleep(0.1)
        except Exception as e:
            print(f"  Failed to embed post {post_id}: {e}")

    return {
        'embeddings': embeddings,
        'post_ids': post_ids
    }


def find_similar_posts(query_post_id: str, similarity_index: dict,
                       analyzed_posts: list, top_k: int = 5) -> list:
    """
    Find the top_k most visually similar posts using cosine similarity on embeddings.

    Returns list of {'post': dict, 'similarity_score': float} sorted by similarity desc.
    """
    post_ids = similarity_index['post_ids']
    embeddings = similarity_index['embeddings']

    if query_post_id not in post_ids:
        return []

    query_idx = post_ids.index(query_post_id)
    query_embedding = embeddings[query_idx]

    # Build lookup from post_id to post
    post_lookup = {}
    for i, post in enumerate(analyzed_posts):
        pid = post.get('id') or post.get('share_url') or str(i)
        post_lookup[pid] = post

    scores = []
    for pid, emb in zip(post_ids, embeddings):
        if pid == query_post_id:
            continue
        sim = cosine_similarity(query_embedding, emb)
        post = post_lookup.get(pid, {'id': pid})
        scores.append({'post': post, 'similarity_score': sim})

    scores.sort(key=lambda x: x['similarity_score'], reverse=True)
    return scores[:top_k]


def analyze_single_post(post: dict, api_key: str) -> dict:
    """
    Analyze a single post's hero image. Returns the post dict with 'visual_analysis' set.
    Safe to call from multiple threads — no shared state is mutated here.
    """
    analysis = analyze_image_themes(post['hero_image'], api_key)
    post['visual_analysis'] = analysis
    return post


def analyze_posts_batch(ltk_posts: list, api_key: str,
                        max_posts: int = None, delay_seconds: float = 0.5) -> list:
    """
    Analyze all LTK posts' hero images in batch using 8 parallel workers.

    - Adds 'visual_analysis' field to each post (None if no hero_image or fetch fails)
    - Parallelizes Gemini image analysis calls with ThreadPoolExecutor(max_workers=8)
    - Limits to max_posts if specified (useful for testing)
    - delay_seconds is kept for signature compatibility but not applied between threads
    """
    posts_with_images = [p for p in ltk_posts if p.get('hero_image')]

    if max_posts is not None:
        posts_with_images = posts_with_images[:max_posts]

    total = len(posts_with_images)
    print(f"Analyzing {total} posts with hero images (8 parallel workers)...")

    completed_count = 0

    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_post = {
            executor.submit(analyze_single_post, post, api_key): post
            for post in posts_with_images
        }

        for future in as_completed(future_to_post):
            completed_count += 1
            original_post = future_to_post[future]
            try:
                result_post = future.result()
                va = result_post.get('visual_analysis')
                themes_str = ', '.join(va.get('themes', [])) if va else 'no themes'
                if completed_count % 10 == 0 or completed_count == total:
                    print(f"  [{completed_count}/{total}] Analyzed: {themes_str}")
            except Exception as e:
                print(f"  [{completed_count}/{total}] Post analysis failed: {e}", file=sys.stderr)
                original_post['visual_analysis'] = None

    # Mark remaining posts (no hero_image) as None
    for post in ltk_posts:
        if 'visual_analysis' not in post:
            post['visual_analysis'] = None

    return ltk_posts


def run_full_visual_analysis(ltk_posts: list, api_key: str) -> dict:
    """
    Main entry point. Runs full visual analysis pipeline.

    Returns:
    {
        'analyzed_posts': list[dict],   # ltk_posts with visual_analysis added
        'similarity_index': dict,       # for similarity search
        'theme_summary': dict,          # theme_name -> count
        'top_themes': list[str],        # ordered by frequency
    }
    """
    # Step 1: Analyze all post images
    analyzed_posts = analyze_posts_batch(ltk_posts, api_key)

    # Step 2: Build similarity index from descriptions
    print("Building similarity index...")
    similarity_index = build_similarity_index(analyzed_posts, api_key)

    # Step 3: Compute theme summary
    theme_summary = {}
    for post in analyzed_posts:
        va = post.get('visual_analysis')
        if not va:
            continue
        for theme in va.get('themes', []):
            theme_summary[theme] = theme_summary.get(theme, 0) + 1

    top_themes = sorted(theme_summary.keys(), key=lambda t: theme_summary[t], reverse=True)

    return {
        'analyzed_posts': analyzed_posts,
        'similarity_index': similarity_index,
        'theme_summary': theme_summary,
        'top_themes': top_themes
    }
