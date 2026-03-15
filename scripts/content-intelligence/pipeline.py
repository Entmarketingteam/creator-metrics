#!/usr/bin/env python3
"""
Content Intelligence Pipeline — Nicki Entenmann Spring 2025
Generates a full interactive HTML analysis report from exported data files.

Usage:
  python pipeline.py --data-dir /path/to/downloads --output output/nicki_spring_2025.html
  python pipeline.py --data-dir /path/to/downloads --fast  # skip visual analysis, use sample
"""

import argparse, sys, os, json
from datetime import datetime, timezone
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

from modules.ingest import load_all_data
from modules.attribution import build_attribution_map
from modules.visual_analysis import run_full_visual_analysis
from modules.caption_nlp import run_caption_analysis
from modules.scoring import run_scoring
from modules.report_generator import build_report_data, generate_report

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY', '')


def _empty_visual_results():
    """Return a safe empty visual results dict matching the module's output contract."""
    return {
        'analyzed_posts': [],
        'theme_summary': {},
        'top_themes': [],
        'similarity_index': {'embeddings': [], 'post_ids': []},
    }


def _upload_report_to_dashboard(report_data: dict, season: str = "spring", year: int = 2025):
    """Upload report data to creator-metrics dashboard via API."""
    import requests

    cron_secret = os.environ.get('CRON_SECRET', '')
    api_url = os.environ.get(
        'CONTENT_LAB_API_URL',
        "https://creator-metrics.vercel.app/api/content-lab/upload-report"
    )

    # Build uploadable payload — strip large base64/embedding data to keep size manageable
    payload = {
        "creator_id": "nicki",  # TODO: make configurable
        "season": season,
        "year": year,
        "report_data": {
            "summary": report_data.get("summary", {}),
            "brands": report_data.get("brands", [])[:20],
            "themes": report_data.get("themes", {}),
            "insights": report_data.get("insights", []),
            "top_ltk_post": report_data.get("top_ltk_post"),
            "top_ig_story": report_data.get("top_ig_story"),
            "top_ig_reel": report_data.get("top_ig_reel"),
            "top_products": report_data.get("top_products", [])[:20],
            "intent_distribution": report_data.get("intent_distribution", {}),
            "hook_type_distribution": report_data.get("hook_type_distribution", {}),
            "engagement_by_intent": report_data.get("engagement_by_intent", {}),
            "top_promo_codes": report_data.get("top_promo_codes", [])[:10],
            "top_brand_mentions": report_data.get("top_brand_mentions", [])[:10],
            "caption_length_performance": report_data.get("caption_length_performance", {}),
            "weekly_performance": report_data.get("weekly_performance", []),
            "ltk_posts": [
                {k: v for k, v in p.items() if k not in ('visual_analysis', 'caption_features')}
                for p in (report_data.get("ltk_posts") or [])[:50]
            ],
        }
    }

    # Make payload JSON-serializable (convert datetime to ISO strings)
    def _json_safe(obj):
        if hasattr(obj, 'isoformat'):
            return obj.isoformat()
        raise TypeError(f"Not serializable: {type(obj)}")

    try:
        payload_json = json.dumps(payload, default=_json_safe)
        resp = requests.post(
            api_url,
            data=payload_json,
            headers={"Authorization": f"Bearer {cron_secret}", "Content-Type": "application/json"},
            timeout=30
        )
        if resp.status_code == 200:
            print(f"  ✓ Report uploaded to dashboard (report_id: {resp.json().get('report_id')})")
        else:
            print(f"  ⚠ Upload failed: {resp.status_code} — {resp.text[:200]}")
    except Exception as e:
        print(f"  ⚠ Upload skipped: {e}")


def run_pipeline(data_dir: str, output_path: str, fast_mode: bool = False,
                 visual_sample: int = None, use_caption_cache: bool = False,
                 use_visual_cache: bool = False,
                 skip_upload: bool = False, season: str = "spring", year: int = 2025):
    """
    Full pipeline:
    1. Load all data
    2. Build attribution map (LTK <-> IG)
    3. Visual analysis (Gemini 2.5 Flash) — optional in fast mode
    4. Caption NLP (Claude CLI)
    5. Performance scoring
    6. Generate report
    7. Upload report data to dashboard (skip with skip_upload=True)
    """

    print(f"\n{'='*60}")
    print(f"Content Intelligence Pipeline")
    print(f"Creator: Nicki Entenmann — Spring 2025")
    print(f"{'='*60}\n")

    # ── Step 1: Load ──────────────────────────────────────────────────────────
    print("Step 1/7: Loading data...")
    data = load_all_data(data_dir)
    print(f"  ✓ {len(data['ltk_posts'])} LTK posts, "
          f"{len(data['ig_stories'])} story rows, "
          f"{len(data['ig_reels'])} reel rows")

    # ── Step 2: Attribution ────────────────────────────────────────────────────
    print("\nStep 2/7: Building attribution map...")
    attribution = build_attribution_map(data)
    stats = attribution['stats']
    print(f"  ✓ {stats['matched_url']} URL matches, {stats['matched_date']} date matches")
    print(f"  ✓ ${stats['total_attributed_commissions']:.2f} attributed to IG content")

    # ── Step 3: Visual analysis ────────────────────────────────────────────────
    visual_cache_path = os.path.join(os.path.dirname(__file__), 'output', 'visual_cache.json')
    print("\nStep 3/7: Running Gemini visual analysis...")
    if fast_mode:
        print("  → Fast mode: skipping visual analysis")
        visual_results = _empty_visual_results()
    elif use_visual_cache and os.path.exists(visual_cache_path):
        print(f"  → Loading visual analysis from cache: {visual_cache_path}")
        with open(visual_cache_path, 'r') as f:
            visual_cache = json.load(f)
        visual_results = visual_cache.get('visual_results', _empty_visual_results())
        # Restore visual_analysis into ltk_posts
        visual_map = visual_cache.get('visual_map', {})
        for post in data['ltk_posts']:
            url = post.get('share_url')
            if url and url in visual_map:
                post['visual_analysis'] = visual_map[url]
        analyzed_count = len([p for p in data['ltk_posts'] if p.get('visual_analysis')])
        print(f"  ✓ {analyzed_count} posts restored from cache")
        if visual_results.get('top_themes'):
            print(f"  ✓ Top themes: {', '.join(visual_results['top_themes'][:5])}")
    else:
        # Filter to Spring 2025 posts only (Mar–May 2025)
        spring_posts = [
            p for p in data['ltk_posts']
            if p.get('date_published') and (
                lambda dt: dt is not None and dt.replace(
                    tzinfo=timezone.utc if dt.tzinfo is None else dt.tzinfo
                ).year == 2025 and dt.month in [3, 4, 5]
            )(p['date_published'])
        ]

        sample_count = visual_sample or len(spring_posts)
        posts_to_analyze = spring_posts[:sample_count]
        print(f"  Analyzing {len(posts_to_analyze)} LTK post images with Gemini 2.5 Flash...")

        visual_results = run_full_visual_analysis(posts_to_analyze, GEMINI_API_KEY)

        # Merge visual results back into all ltk_posts by share_url
        visual_map = {
            p.get('share_url'): p.get('visual_analysis')
            for p in visual_results['analyzed_posts']
            if p.get('visual_analysis') and p.get('share_url')
        }
        for post in data['ltk_posts']:
            if post.get('share_url') in visual_map:
                post['visual_analysis'] = visual_map[post['share_url']]

        analyzed_count = len([p for p in data['ltk_posts'] if p.get('visual_analysis')])
        print(f"  ✓ {analyzed_count} posts analyzed")
        if visual_results['top_themes']:
            print(f"  ✓ Top themes: {', '.join(visual_results['top_themes'][:5])}")

        # Save visual cache for future runs (avoids re-running Gemini)
        def _strip_embeddings(vr):
            """Remove large embedding arrays before caching."""
            vr = dict(vr)
            vr['similarity_index'] = {'embeddings': [], 'post_ids': []}
            return vr
        try:
            with open(visual_cache_path, 'w') as f:
                json.dump({
                    'visual_results': _strip_embeddings(visual_results),
                    'visual_map':     visual_map,
                }, f)
            print(f"  ✓ Visual cache saved to {visual_cache_path}")
        except Exception as e:
            print(f"  ⚠ Could not save visual cache: {e}")

    # ── Step 4: Caption NLP ────────────────────────────────────────────────────
    cache_path = os.path.join(os.path.dirname(__file__), 'output', 'caption_cache.json')
    if use_caption_cache and os.path.exists(cache_path):
        print("\nStep 4/7: Loading caption results from cache...")
        with open(cache_path, 'r') as f:
            caption_results = json.load(f)
        print(f"  ✓ Loaded from {cache_path}")
    else:
        print("\nStep 4/7: Running caption analysis...")
        caption_results = run_caption_analysis(data)
        # Save cache
        def _make_serializable(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            return str(obj)
        with open(cache_path, 'w') as f:
            json.dump(caption_results, f, default=_make_serializable)
        print(f"  ✓ Caption cache saved to {cache_path}")
    print(f"  ✓ {caption_results['stats']['total_analyzed']} captions analyzed")
    intent_dist = caption_results.get('intent_distribution', {})
    top_intent = (
        max(intent_dist, key=intent_dist.get)
        if intent_dist else 'n/a'
    )
    print(f"  ✓ Top intent: {top_intent}")

    # ── Step 5: Scoring ────────────────────────────────────────────────────────
    print("\nStep 5/7: Computing performance scores...")
    scoring_results = run_scoring(data, attribution, visual_results, caption_results)
    summary = scoring_results['summary']
    print(f"  ✓ ${summary['total_commissions']:.2f} total commissions")
    print(f"  ✓ {summary['total_ltk_clicks']:,} total LTK clicks")
    print(f"  ✓ Top brand: {summary['top_brand']}")
    print("\n  Key Insights:")
    for insight in scoring_results['insights']:
        print(f"  • {insight}")

    # ── Step 6: Generate report ────────────────────────────────────────────────
    print("\nStep 6/7: Generating HTML report...")

    # Build base report_data structure from report_generator
    # It expects caption_results to have 'top_words' key — caption_nlp returns 'word_frequency'
    caption_results_for_report = dict(caption_results)
    caption_results_for_report['top_words'] = caption_results.get('word_frequency', [])

    # Normalize None numeric fields to 0 so report_generator sums don't fail
    # (ingest returns None for missing/unparseable values)
    def _normalize_post_numerics(posts, fields):
        for p in posts:
            for f in fields:
                if p.get(f) is None:
                    p[f] = 0
        return posts

    _ltk_numeric_fields = ['clicks', 'commissions', 'orders', 'items_sold',
                           'order_conversion_rate', 'items_sold_conversion_rate']
    _ig_numeric_fields  = ['views', 'reach', 'likes', 'shares', 'follows',
                           'link_clicks', 'sticker_taps', 'replies', 'navigation',
                           'comments', 'saves']

    # Work on copies to avoid mutating scored data
    import copy
    data_for_report = dict(data)
    data_for_report['ltk_posts'] = _normalize_post_numerics(
        copy.deepcopy(data['ltk_posts']), _ltk_numeric_fields)
    data_for_report['ig_stories'] = _normalize_post_numerics(
        copy.deepcopy(data['ig_stories']), _ig_numeric_fields)
    data_for_report['ig_reels'] = _normalize_post_numerics(
        copy.deepcopy(data['ig_reels']), _ig_numeric_fields)

    # Ensure SEO fields have defaults
    _seo_defaults = {'seo_score': 0, 'hook_quality_label': 'weak',
                     'hashtag_quality': 'none', 'cta_type': 'none',
                     'seo_breakdown': {}, 'hook_text': ''}
    for collection in (data_for_report['ig_stories'], data_for_report['ig_reels']):
        for item in collection:
            for k, v in _seo_defaults.items():
                if item.get(k) is None:
                    item[k] = v

    # report_generator._build_weekly_performance expects date_published as string (ISO),
    # but ingest returns actual datetime objects — convert to ISO strings
    for p in data_for_report['ltk_posts']:
        dt = p.get('date_published')
        if dt is not None and hasattr(dt, 'isoformat'):
            p['date_published'] = dt.isoformat()
    for s in data_for_report['ig_stories']:
        for field in ('publish_time', 'date_parsed'):
            dt = s.get(field)
            if dt is not None and hasattr(dt, 'isoformat'):
                s[field] = dt.isoformat()
        # report_generator uses 'date' key for weekly bucketing in stories
        if s.get('date_is_lifetime') and s.get('publish_time') and isinstance(s.get('publish_time'), str):
            s['date'] = s['publish_time'][:10]
    for r in data_for_report['ig_reels']:
        for field in ('publish_time', 'date_parsed'):
            dt = r.get(field)
            if dt is not None and hasattr(dt, 'isoformat'):
                r[field] = dt.isoformat()

    # Pass empty visual_results to build_report_data so it uses _derive_themes_from_posts
    # instead of visual_results['theme_summary'] (which is {theme: count_int}, not the
    # {theme: {"avg_commissions": ...}} format report_generator._generate_insights expects).
    # We override report_data['themes'] with scoring's theme_performance right after anyway.
    visual_results_for_report = dict(visual_results)
    visual_results_for_report['theme_summary'] = {}  # suppress theme_summary from visual module

    report_data = build_report_data(data_for_report, attribution, visual_results_for_report, caption_results_for_report)

    # Override with scored/enriched data from scoring module
    # Add 'caption' alias for 'description' so the report template can use p.caption
    ltk_scored = scoring_results['ltk_posts_scored']
    for p in ltk_scored:
        if 'caption' not in p:
            p['caption'] = p.get('description') or ''
    report_data['ltk_posts'] = ltk_scored
    report_data['ig_stories'] = scoring_results['ig_stories_scored']
    report_data['ig_reels'] = scoring_results['ig_reels_scored']

    # Normalize weekly_performance keys for the template:
    # scoring produces: week_start, ltk_commissions, ltk_clicks, story_views
    # template expects: week, commissions, clicks, story_views
    report_data['weekly_performance'] = [
        {
            'week':        w.get('week_start') or w.get('week', ''),
            'commissions': w.get('ltk_commissions', w.get('commissions', 0)),
            'clicks':      w.get('ltk_clicks', w.get('clicks', 0)),
            'story_views': w.get('story_views', 0),
        }
        for w in scoring_results['weekly_performance']
    ]
    report_data['insights'] = scoring_results['insights']
    report_data['summary'] = summary
    report_data['themes'] = scoring_results['theme_performance']

    # Inject top performers from scoring summary (not surfaced by build_report_data)
    report_data['top_ltk_post']  = summary.get('top_ltk_post')
    report_data['top_ig_story']  = summary.get('top_ig_story')
    report_data['top_ig_reel']   = summary.get('top_ig_reel')
    report_data['date_range']    = summary.get('date_range', 'Spring 2025')

    # Override top_products with the scored module's ranked list
    # (scoring_results['top_products'] is already ranked by commissions with 'rank' field)
    if scoring_results.get('top_products'):
        report_data['top_products'] = scoring_results['top_products']

    # Inject brand data from ltk_brands (ingest already aggregated this)
    # Convert ltk_brands format to report format (name + metrics)
    ltk_brands = data.get('ltk_brands', [])
    if ltk_brands:
        report_data['brands'] = [
            {
                'name':        b.get('advertiser_name') or '—',
                'commissions': b.get('commissions') or 0.0,
                'clicks':      b.get('clicks') or 0,
                'orders':      b.get('orders') or 0,
            }
            for b in sorted(ltk_brands, key=lambda x: x.get('commissions') or 0, reverse=True)
        ]

    # Inject top caption words
    report_data['top_caption_words'] = caption_results.get('word_frequency', [])

    # Inject full caption intelligence fields for the report
    report_data['intent_distribution'] = caption_results.get('intent_distribution', {})
    report_data['hook_type_distribution'] = caption_results.get('hook_type_distribution', {})
    report_data['top_promo_codes'] = caption_results.get('top_promo_codes', [])
    report_data['top_brand_mentions'] = caption_results.get('top_brand_mentions', [])
    report_data['high_performing_captions'] = caption_results.get('high_performing_captions', [])
    report_data['engagement_by_intent'] = caption_results.get('engagement_by_intent', {})
    report_data['caption_length_performance'] = caption_results.get('caption_length_performance', {})

    # New analytical insights from scoring module
    report_data['hook_revenue_correlation'] = scoring_results.get('hook_revenue_correlation', [])
    report_data['best_posting_days']        = scoring_results.get('best_posting_days', [])
    report_data['revenue_spikes']           = scoring_results.get('revenue_spikes', [])

    # SEO aggregate fields for Section 7
    report_data['avg_seo_score']          = caption_results.get('avg_seo_score', 0)
    report_data['seo_score_distribution'] = caption_results.get('seo_score_distribution', {})
    report_data['seo_top_issues']         = caption_results.get('seo_top_issues', [])
    report_data['seo_prescriptions']      = caption_results.get('seo_prescriptions', [])

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    generate_report(report_data, output_path)
    file_size = os.path.getsize(output_path) / 1024

    print(f"\n{'='*60}")
    print(f"✅ Report generated: {output_path}")
    print(f"   Size: {file_size:.0f}KB")
    print(f"   Open in browser: open '{output_path}'")
    print(f"{'='*60}\n")

    # ── Step 7: Upload to dashboard ────────────────────────────────────────────
    if not skip_upload:
        print("Step 7/7: Uploading report to dashboard...")
        _upload_report_to_dashboard(report_data, season=season, year=year)
    else:
        print("Step 7/7: Skipping dashboard upload (--skip-upload)")

    return output_path


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Content Intelligence Pipeline — Nicki Entenmann Spring 2025'
    )
    parser.add_argument('--data-dir', default='/Users/ethanatchley/Downloads',
                        help='Directory containing the CSV exports')
    parser.add_argument('--output', default='output/nicki_spring_2025_report.html',
                        help='Output HTML file path')
    parser.add_argument('--fast', action='store_true',
                        help='Skip Gemini visual analysis (fast test mode)')
    parser.add_argument('--visual-sample', type=int, default=None,
                        help='Analyze only N posts visually (default: all Spring posts)')
    parser.add_argument('--use-caption-cache', action='store_true',
                        help='Load caption results from cache instead of re-running Claude NLP')
    parser.add_argument('--use-visual-cache', action='store_true',
                        help='Load visual analysis from cache instead of re-running Gemini')
    parser.add_argument('--season', default='spring',
                        help='Season label (spring/summer/fall/winter)')
    parser.add_argument('--year', type=int, default=2025,
                        help='Year of the content')
    parser.add_argument('--skip-upload', action='store_true',
                        help='Skip uploading report data to dashboard')
    args = parser.parse_args()

    output = args.output
    if not os.path.isabs(output):
        output = os.path.join(os.path.dirname(__file__), output)

    run_pipeline(args.data_dir, output, fast_mode=args.fast,
                 visual_sample=args.visual_sample,
                 use_caption_cache=args.use_caption_cache,
                 use_visual_cache=args.use_visual_cache,
                 skip_upload=args.skip_upload,
                 season=args.season,
                 year=args.year)
