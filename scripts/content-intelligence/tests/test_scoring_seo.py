import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from modules.scoring import score_ig_stories_batch, score_ig_reels_batch

def _story(views=1000, reach=900, likes=10, replies=2, follows=1,
           link_clicks=5, sticker_taps=0, seo_score=80):
    return {
        "views": views, "reach": reach, "likes": likes, "replies": replies,
        "follows": follows, "link_clicks": link_clicks, "sticker_taps": sticker_taps,
        "seo_score": seo_score,
    }

def _reel(views=5000, likes=100, comments=10, saves=50, shares=20, seo_score=75):
    return {
        "views": views, "likes": likes, "comments": comments,
        "saves": saves, "shares": shares, "seo_score": seo_score,
    }

def test_story_seo_score_field_present():
    stories = [_story(seo_score=80), _story(seo_score=20)]
    scored = score_ig_stories_batch(stories)
    assert "seo_score" in scored[0]

def test_story_composite_includes_seo_weight():
    """Story = 50% virality + 35% engagement + 15% SEO.
    With identical virality/engagement, higher SEO = higher composite."""
    base = {"views": 500, "reach": 400, "likes": 5, "replies": 1, "follows": 0,
            "link_clicks": 2, "sticker_taps": 0}
    high_seo = score_ig_stories_batch([{**base, "seo_score": 100}, {**base, "seo_score": 0}])
    assert high_seo[0]["composite_score"] > high_seo[1]["composite_score"]

def test_story_no_seo_score_defaults_zero():
    """Stories without seo_score field should not crash."""
    stories = [{"views": 100, "reach": 90, "likes": 1, "replies": 0, "follows": 0,
                "link_clicks": 0, "sticker_taps": 0}]
    scored = score_ig_stories_batch(stories)
    assert "composite_score" in scored[0]

def test_reel_composite_includes_seo_weight():
    """Reel = 44% virality + 27% engagement + 17% saves + 12% SEO.
    With identical base, higher SEO = higher composite."""
    base = {"views": 5000, "likes": 100, "comments": 10, "saves": 50, "shares": 20}
    scored = score_ig_reels_batch([{**base, "seo_score": 100}, {**base, "seo_score": 0}])
    assert scored[0]["composite_score"] > scored[1]["composite_score"]

def test_reel_no_seo_score_defaults_zero():
    reels = [{"views": 1000, "likes": 50, "comments": 5, "saves": 20, "shares": 10}]
    scored = score_ig_reels_batch(reels)
    assert "composite_score" in scored[0]
