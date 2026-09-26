import json

from conftest import make_body

from engine import writer as writer_mod
from engine.site import build_site
from engine.writer import Writer


def test_build_site(cfg, good_article, tmp_path):
    cfg.programs_by_id["school-general"]["url"] = ""
    info = build_site(cfg, articles=[good_article], out_dir=tmp_path / "public")
    out = tmp_path / "public"
    page = (out / "articles" / good_article.slug / "index.html").read_text(encoding="utf-8")
    assert "本記事にはアフィリエイト広告" in page          # ステマ規制対応のPR表記
    assert "application/ld+json" in page
    assert 'rel="canonical"' in page
    assert "<table" in page or "cta-box" in page
    assert (out / "sitemap.xml").read_text().count("<url>") >= 3
    assert (out / "robots.txt").exists() and (out / "feed.xml").exists()
    assert (out / "about" / "index.html").exists() and (out / "privacy" / "index.html").exists()
    assert (out / "static" / "style.css").exists()
    assert (out / "articles" / good_article.slug / "cover.png").stat().st_size > 5000
    assert (out / "static" / "og-default.png").exists() and (out / "favicon.svg").exists()
    assert "summary_large_image" in page and "cover.png" in page
    assert 'class="box box-summary"' in page
    assert '"FAQPage"' in page
    home = (out / "index.html").read_text(encoding="utf-8")
    assert '"WebSite"' in home and "card-img" in home
    assert (out / "category" / "school" / "index.html").exists()
    assert info["articles"] == 1


class FakeLLM:
    """ネットワークを使わずにパイプライン全体を検証するための偽LLM。"""

    def __init__(self, first_body, score_seq=(8,)):
        self.first_body = first_body
        self.scores = list(score_seq)
        self.calls = []

    def research(self, *, task, system, prompt, effort="medium"):
        self.calls.append(task)
        return "調査メモ", [{"title": "公式", "url": "https://example.com/a"},
                         {"title": "統計", "url": "https://example.go.jp/b"}]

    def structured(self, *, task, system, prompt, schema, effort="high"):
        self.calls.append(task)
        if task == "review":
            return {"score": self.scores.pop(0), "problems": ["具体例が不足"]}
        body = self.first_body if task == "write" else make_body("修正版")
        return {
            "title": "社会人向けプログラミングスクールの選び方と比較のポイント",
            "slug": "Programming School Guide!",
            "description": "社会人がプログラミングスクールを選ぶときに確認したい、目的・料金・サポート体制などの比較ポイントを公開情報をもとに整理しました。",
            "category": "school",
            "tags": ["スクール"],
            "programs": ["school-general"],
            "source_urls": ["https://example.com/a", "https://example.go.jp/b", "https://hallucinated.example/x"],
            "body_markdown": body,
        }


def test_writer_pipeline_repairs_and_filters_sources(cfg, monkeypatch):
    monkeypatch.setattr(writer_mod, "load_articles", lambda: [])
    llm = FakeLLM(first_body="短すぎる本文 実際に受講してわかった", score_seq=[8])
    result = Writer(cfg, llm).write({"keyword": "スクール 選び方", "intent": "commercial",
                                     "category": "school", "program": "school-general"})
    assert result.article is not None, result.issues
    assert llm.calls == ["research", "write", "repair", "review"]
    assert result.article.slug == "programming-school-guide"
    assert [s["url"] for s in result.article.sources] == ["https://example.com/a", "https://example.go.jp/b"]
    assert result.article.editor_score == 8


def test_writer_rejects_after_low_review(cfg, monkeypatch):
    monkeypatch.setattr(writer_mod, "load_articles", lambda: [])
    llm = FakeLLM(first_body=make_body(), score_seq=[4, 5])
    result = Writer(cfg, llm).write({"keyword": "k", "category": "school", "program": "school-general"})
    assert result.article is None
    assert any("編集長レビュー" in i for i in result.issues)
    assert json.dumps(result.issues, ensure_ascii=False)
