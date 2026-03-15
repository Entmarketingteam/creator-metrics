#!/usr/bin/env python3
"""
caption-backfill.py — Bulk-analyze media_snapshots captions into caption_analysis.

Reads unanalyzed (or stale) captions from Supabase, runs Claude CLI analysis
in parallel, writes results back directly.

Usage:
  python3 tools/caption-backfill.py [--batch 200] [--workers 8] [--creator nicki_entenmann]

Credentials pulled from .env.local (DATABASE_URL).
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from typing import Optional

import psycopg2
import psycopg2.extras

# ── Config ────────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.parent

def get_db_url() -> str:
    env_file = REPO_ROOT / ".env.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'").rstrip("\\n")
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    raise RuntimeError("DATABASE_URL not found in .env.local or environment")

PROMPT_TEMPLATE = """\
Analyze this Instagram caption for SEO and engagement optimization.
Return a JSON object with EXACTLY these fields (no markdown, just JSON):
{{
  "seo_score": <integer 0-100>,
  "seo_breakdown": {{
    "hook_quality": <0-20>,
    "keyword_relevance": <0-25>,
    "hashtag_efficiency": <0-15>,
    "cta_quality": <0-15>,
    "brand_mentions": <0-10>,
    "alt_text_flag": <0-10>,
    "engagement_mechanics": <0-5>
  }},
  "hook_text": "<first 125 chars of caption>",
  "hook_quality_label": "<strong|moderate|weak>",
  "hashtag_quality": "<optimal|over_limit|none>",
  "cta_type": "<dm|link_bio|none>",
  "intent": "<sale_promotion|product_showcase|lifestyle|entertainment|educational|call_to_action|personal_story|trend_moment>",
  "tone": "<casual|excited|informative|humorous|aspirational>",
  "hook_type": "<discount|trend|relatable_humor|aspiration|education|challenge|personal_story|product_reveal>",
  "key_topics": ["<topic1>", "<topic2>"],
  "product_category": "<fashion|fitness|home|beauty|food|travel|lifestyle|kids|other>",
  "has_urgency": <true|false>,
  "virality_signals": ["<relatable|funny|inspiring|informative|controversial|satisfying>"],
  "recommendations": ["<actionable tip 1>", "<actionable tip 2>"]
}}

Caption:
{caption}
"""

_STRIP_MD = re.compile(r"^```[a-z]*\n?|\n?```$")

def caption_hash(caption: str) -> str:
    return hashlib.sha256(caption.encode()).hexdigest()[:16]

def analyze_one(row: dict) -> Optional[dict]:
    """Call Claude CLI for one caption. Returns parsed dict or None on failure."""
    caption = (row["caption"] or "").strip()
    if not caption:
        return None

    prompt = PROMPT_TEMPLATE.format(caption=caption[:2000])
    try:
        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=60,
            env={**os.environ, "CLAUDECODE": ""},
        )
        raw = result.stdout.strip()
        raw = _STRIP_MD.sub("", raw).strip()
        # Find JSON object in output
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start == -1 or end == 0:
            print(f"  [WARN] No JSON in output for {row['media_ig_id']}: {raw[:100]}")
            return None
        return json.loads(raw[start:end])
    except subprocess.TimeoutExpired:
        print(f"  [TIMEOUT] {row['media_ig_id']}")
        return None
    except json.JSONDecodeError as e:
        print(f"  [JSON ERR] {row['media_ig_id']}: {e}")
        return None
    except Exception as e:
        print(f"  [ERR] {row['media_ig_id']}: {e}")
        return None

def upsert_row(cur, row: dict, analysis: dict):
    hash_val = caption_hash(row["caption"])
    cur.execute("""
        INSERT INTO caption_analysis (
            media_ig_id, creator_id, caption_hash,
            seo_score, seo_breakdown, hook_text, hook_quality_label,
            hashtag_quality, cta_type, intent, tone, hook_type,
            key_topics, product_category, has_urgency,
            virality_signals, recommendations, analyzed_at
        ) VALUES (
            %(media_ig_id)s, %(creator_id)s, %(caption_hash)s,
            %(seo_score)s, %(seo_breakdown)s, %(hook_text)s, %(hook_quality_label)s,
            %(hashtag_quality)s, %(cta_type)s, %(intent)s, %(tone)s, %(hook_type)s,
            %(key_topics)s, %(product_category)s, %(has_urgency)s,
            %(virality_signals)s, %(recommendations)s, NOW()
        )
        ON CONFLICT (media_ig_id, creator_id) DO UPDATE SET
            caption_hash      = EXCLUDED.caption_hash,
            seo_score         = EXCLUDED.seo_score,
            seo_breakdown     = EXCLUDED.seo_breakdown,
            hook_text         = EXCLUDED.hook_text,
            hook_quality_label = EXCLUDED.hook_quality_label,
            hashtag_quality   = EXCLUDED.hashtag_quality,
            cta_type          = EXCLUDED.cta_type,
            intent            = EXCLUDED.intent,
            tone              = EXCLUDED.tone,
            hook_type         = EXCLUDED.hook_type,
            key_topics        = EXCLUDED.key_topics,
            product_category  = EXCLUDED.product_category,
            has_urgency       = EXCLUDED.has_urgency,
            virality_signals  = EXCLUDED.virality_signals,
            recommendations   = EXCLUDED.recommendations,
            analyzed_at       = NOW()
    """, {
        "media_ig_id":       row["media_ig_id"],
        "creator_id":        row["creator_id"],
        "caption_hash":      caption_hash(row["caption"]),
        "seo_score":         analysis.get("seo_score"),
        "seo_breakdown":     json.dumps(analysis.get("seo_breakdown", {})),
        "hook_text":         analysis.get("hook_text"),
        "hook_quality_label": analysis.get("hook_quality_label"),
        "hashtag_quality":   analysis.get("hashtag_quality"),
        "cta_type":          analysis.get("cta_type"),
        "intent":            analysis.get("intent"),
        "tone":              analysis.get("tone"),
        "hook_type":         analysis.get("hook_type"),
        "key_topics":        json.dumps(analysis.get("key_topics", [])),
        "product_category":  analysis.get("product_category"),
        "has_urgency":       bool(analysis.get("has_urgency", False)),
        "virality_signals":  json.dumps(analysis.get("virality_signals", [])),
        "recommendations":   json.dumps(analysis.get("recommendations", [])),
    })

def main():
    parser = argparse.ArgumentParser(description="Bulk-backfill caption_analysis from media_snapshots")
    parser.add_argument("--batch", type=int, default=200, help="Max rows to process (default 200)")
    parser.add_argument("--workers", type=int, default=6, help="Parallel Claude workers (default 6)")
    parser.add_argument("--creator", default=None, help="Filter to one creator_id")
    parser.add_argument("--force", action="store_true", help="Re-analyze even if already analyzed")
    args = parser.parse_args()

    db_url = get_db_url()
    conn = psycopg2.connect(db_url)
    conn.autocommit = False

    creator_filter = f"AND ms.creator_id = '{args.creator}'" if args.creator else ""
    stale_filter = "" if args.force else """
        AND NOT EXISTS (
            SELECT 1 FROM caption_analysis ca
            WHERE ca.media_ig_id = ms.media_ig_id
              AND ca.creator_id = ms.creator_id
        )
    """

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(f"""
            SELECT ms.media_ig_id, ms.creator_id, ms.caption
            FROM media_snapshots ms
            WHERE ms.caption IS NOT NULL
              AND ms.caption != ''
              {creator_filter}
              {stale_filter}
            ORDER BY ms.captured_at DESC
            LIMIT {args.batch}
        """)
        rows = cur.fetchall()

    total = len(rows)
    if total == 0:
        print("✓ Nothing to analyze — all captions are up to date.")
        conn.close()
        return

    print(f"Analyzing {total} captions with {args.workers} workers...")
    processed = errors = 0

    def process_row(row):
        analysis = analyze_one(row)
        return row, analysis

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process_row, dict(r)): dict(r) for r in rows}
        with conn.cursor() as cur:
            for future in as_completed(futures):
                row, analysis = future.result()
                if analysis is None:
                    errors += 1
                    continue
                try:
                    upsert_row(cur, row, analysis)
                    conn.commit()
                    processed += 1
                    score = analysis.get("seo_score", "?")
                    intent = analysis.get("intent", "?")
                    print(f"  ✓ {row['media_ig_id']} score={score} intent={intent} [{processed}/{total}]")
                except Exception as e:
                    conn.rollback()
                    errors += 1
                    print(f"  ✗ DB write failed for {row['media_ig_id']}: {e}")

    print(f"\nDone. {processed} analyzed, {errors} errors out of {total} total.")
    conn.close()

if __name__ == "__main__":
    main()
