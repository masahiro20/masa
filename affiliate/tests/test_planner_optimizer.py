from datetime import date

from engine.articles import Article
from engine.optimizer import select_refresh_candidates
from engine.planner import KeywordQueue, normalize, score


def test_score_prefers_transactional_high_reward(cfg):
    progs = cfg.programs_by_id
    hi = score({"program": "career-it-agent", "intent": "transactional"}, progs)
    lo = score({"program": "learning-books", "intent": "informational"}, progs)
    assert hi > lo


def test_queue_add_dedupes_and_validates(cfg, tmp_path):
    q = KeywordQueue(tmp_path / "k.yaml")
    added = q.add([
        {"keyword": "IT転職 エージェント 比較", "intent": "commercial", "category": "career", "program": "career-it-agent"},
        {"keyword": "エージェント  IT転職 比較", "intent": "commercial", "category": "career", "program": "career-it-agent"},
        {"keyword": "存在しない案件", "intent": "commercial", "category": "career", "program": "nope"},
        {"keyword": "カテゴリ不正", "intent": "commercial", "category": "zzz", "program": "tools-domain"},
    ], cfg)
    assert added == 2
    assert q.items[-1]["category"] == "tools"
    q.rescore(cfg.programs_by_id)
    q.save()
    assert len(KeywordQueue(tmp_path / "k.yaml").queued) == 2
    assert normalize("A  b") == normalize("b a")


def _art(slug, updated):
    return Article(title=slug, slug=slug, description="", category="school", body="", published=updated,
                   updated=updated)


def test_refresh_by_age_oldest_first():
    arts = [_art("new", "2026-09-01"), _art("old", "2026-01-01"), _art("mid", "2026-05-01")]
    picks = select_refresh_candidates(arts, base_url="https://x", limit=2, refresh_after_days=90, gsc=None,
                                      today=date(2026, 9, 25))
    assert [a.slug for a, _ in picks] == ["old", "mid"]


def test_refresh_prefers_gsc_opportunities():
    arts = [_art("old", "2026-01-01"), _art("striking", "2026-08-01")]
    gsc = {"https://x/articles/striking/": {"clicks": 3, "impressions": 800, "ctr": 0.004, "position": 9.2}}
    picks = select_refresh_candidates(arts, base_url="https://x", limit=1, refresh_after_days=90, gsc=gsc,
                                      today=date(2026, 9, 25))
    assert picks[0][0].slug == "striking"
    assert "9.2位" in picks[0][1]
