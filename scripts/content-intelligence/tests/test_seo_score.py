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
