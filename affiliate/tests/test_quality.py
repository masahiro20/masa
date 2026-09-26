import copy

from engine.quality import check_article


def run(cfg, article, existing=()):
    return check_article(article, quality=cfg.quality, programs=cfg.programs_by_id,
                         categories=set(cfg.category_names), existing=list(existing))


def test_good_article_passes(cfg, good_article):
    report = run(cfg, good_article)
    assert report.passed, report.issues


def test_fake_experience_is_rejected(cfg, good_article):
    good_article.body += "\n\n実際に受講してわかったことをまとめます。"
    assert any("実体験" in i for i in run(cfg, good_article).issues)


def test_first_person_usage_is_rejected(cfg, good_article):
    good_article.body += "\n\n私が利用した感想です。"
    assert any("実体験" in i for i in run(cfg, good_article).issues)


def test_risky_claims_are_rejected(cfg, good_article):
    for phrase in ["必ず稼げる", "業界No.1の実績", "誰でも簡単に稼げる"]:
        a = copy.deepcopy(good_article)
        a.body += f"\n\n{phrase}"
        assert any("誇大" in i for i in run(cfg, a).issues), phrase


def test_missing_sources_and_links(cfg, good_article):
    good_article.sources = [{"title": "x", "url": "not-a-url"}]
    good_article.body = good_article.body.replace("{{aff:school-general}}", "{{aff:unknown-id}}")
    issues = run(cfg, good_article).issues
    assert any("出典" in i for i in issues)
    assert any("未知のアフィリエイトID" in i for i in issues)


def test_manual_articles_do_not_need_sources(cfg, good_article):
    good_article.origin = "manual"
    good_article.sources = []
    assert run(cfg, good_article).passed


def test_duplicate_content_detected(cfg, good_article):
    other = copy.deepcopy(good_article)
    other.slug = "another-slug"
    other.title = "別のタイトルですがほとんど同じ内容の記事になっています"
    issues = run(cfg, good_article, [other]).issues
    assert any("似すぎ" in i for i in issues)


def test_short_and_h1(cfg, good_article):
    good_article.body = "# 見出し\n\n短い本文 {{aff:school-general}}"
    issues = run(cfg, good_article).issues
    assert any("短すぎ" in i for i in issues)
    assert any("H1" in i for i in issues)


def test_blocks_and_internal_links(cfg, good_article):
    import copy
    a = copy.deepcopy(good_article)
    a.body = a.body.replace(":::summary", "").replace(":::point 最初に決めること", "")
    assert any("図解ブロック" in i for i in run(cfg, a).issues)
    b = copy.deepcopy(good_article)
    b.body += "\n\n{{link:no-such-article}}"
    assert any("内部リンク" in i for i in run(cfg, b).issues)
