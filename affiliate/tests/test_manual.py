import json

import pytest
from conftest import make_body

from engine import cli, manual
from engine.articles import Article
from engine.planner import KeywordQueue


@pytest.fixture
def sandbox(tmp_path, monkeypatch, cfg):
    """データファイルを一時ディレクトリに切り替えて、本物の在庫やログを汚さない。"""
    kw = tmp_path / "keywords.yaml"
    q = KeywordQueue(kw)
    q.items = [{"keyword": "スクール 選び方", "intent": "commercial", "category": "school",
                "program": "school-general", "score": 0, "status": "queued"}]
    q.save()
    monkeypatch.setattr("engine.planner.KEYWORDS_FILE", kw)
    monkeypatch.setattr(KeywordQueue.__init__, "__defaults__", (kw,))
    monkeypatch.setattr(manual, "RUN_LOG_FILE", tmp_path / "run_log.jsonl")
    monkeypatch.setattr(cli, "RUN_LOG_FILE", tmp_path / "run_log.jsonl")
    monkeypatch.setattr(cli, "STATUS_FILE", tmp_path / "STATUS.md")
    monkeypatch.setattr(manual, "load_articles", lambda: [])
    monkeypatch.setattr(cli, "load_articles", lambda: [])
    return tmp_path


def _write(tmp_path, body=None, slug="school-guide"):
    a = Article(title="社会人向けプログラミングスクールの選び方と比較のポイント", slug=slug,
                description="社会人がプログラミングスクールを選ぶときに確認したい、目的・料金・サポート体制などの比較ポイントを、公開情報をもとにわかりやすく整理しました。",
                category="school", body=body or make_body(), tags=["スクール"], keyword="スクール 選び方",
                programs=["school-general"],
                sources=[{"title": "A", "url": "https://example.com/a"}, {"title": "B", "url": "https://example.org/b"}],
                published="2026-09-29", updated="2026-09-29")
    path = tmp_path / f"{slug}.md"
    path.write_text(a.to_text(), encoding="utf-8")
    return path


def test_next_lists_queue_and_existing(sandbox, cfg, capsys):
    assert cli.main(["next"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["next"][0]["keyword"] == "スクール 選び方"
    assert "school-general" in out["program_ids"]


def test_validate_and_publish(sandbox, cfg, capsys):
    good = _write(sandbox)
    assert cli.main(["validate", str(good)]) == 0
    bad = _write(sandbox, body="短い", slug="bad-one")
    assert cli.main(["validate", str(bad)]) == 1
    assert cli.main(["publish", str(bad), "--keyword", "スクール 選び方"]) == 1
    assert cli.main(["publish", str(good), "--keyword", "スクール 選び方"]) == 0
    item = KeywordQueue().items[0]
    assert item["status"] == "published" and item["slug"] == "school-guide"
    log = (sandbox / "run_log.jsonl").read_text(encoding="utf-8")
    assert '"routine"' in log and "school-guide" in log


def test_add_keywords_and_reject(sandbox, cfg):
    f = sandbox / "kw.json"
    f.write_text(json.dumps([
        {"keyword": "IT転職 エージェント 比較", "intent": "commercial", "category": "career", "program": "career-it-agent"},
        {"keyword": "不正", "intent": "commercial", "category": "career", "program": "nope"},
    ], ensure_ascii=False), encoding="utf-8")
    assert cli.main(["add-keywords", str(f)]) == 0
    assert len(KeywordQueue().queued) == 2
    assert cli.main(["reject", "--keyword", "IT転職 エージェント 比較", "--reason", "情報不足"]) == 0
    assert len(KeywordQueue().queued) == 1
