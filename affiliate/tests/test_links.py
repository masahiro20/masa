from engine.links import expand_shortcodes, find_shortcodes, with_early_cta

PROGRAMS = {
    "a": {"id": "a", "name": "サービスA", "url": "https://px.a8.net/x?a=1&b=2", "cta": "申し込む"},
    "b": {"id": "b", "name": "サービスB", "url": "", "cta": "見る"},
}


def test_find():
    assert find_shortcodes("x {{aff:a}} y {{aff:b|文言}}") == ["a", "b"]


def test_cta_box_with_url():
    out = expand_shortcodes("{{aff:a}}", PROGRAMS)
    assert 'class="cta-button"' in out and 'rel="sponsored noopener"' in out
    assert "https://px.a8.net/x?a=1&amp;b=2" in out
    assert "PR" in out


def test_unlinked_program_renders_without_link():
    out = expand_shortcodes("{{aff:b}} と {{aff:b|詳細}}", PROGRAMS)
    assert "<a " not in out
    assert "is-disabled" in out and "詳細" in out


def test_inline_link_and_unknown():
    assert '>公式<' in expand_shortcodes("{{aff:a|公式}}", PROGRAMS)
    assert expand_shortcodes("{{aff:zzz|テキスト}}", PROGRAMS) == "テキスト"


def test_early_cta_added_when_first_live_ad_is_late():
    progs = {"live": {"id": "live", "name": "案件", "url": "https://x.example/a", "cta": "見る"},
             "dead": {"id": "dead", "name": "未提携", "url": "", "cta": "見る"}}
    body = "導入\n\n## 一\n" + "あ" * 200 + "\n\n## 二\n" + "い" * 2000 + "\n\n{{aff:live}}\n\n## 三\nおわり"
    out = with_early_cta(body, progs)
    assert out.index("{{aff:live}}") < out.index("## 二")
    assert out.count("{{aff:live}}") == 2
    # すでに前半にある／未提携の案件／節が足りない場合は何もしない
    assert with_early_cta("導入\n\n{{aff:live}}\n\n## 一\n" + "あ" * 500, progs).count("{{aff:live}}") == 1
    assert with_early_cta(body.replace("{{aff:live}}", "{{aff:dead}}"), progs) == body.replace("{{aff:live}}", "{{aff:dead}}")
    assert with_early_cta("導入\n\n## 一\n" + "あ" * 2000 + "\n\n{{aff:live}}", progs).count("{{aff:live}}") == 1


def test_early_cta_judged_by_box_not_inline_link():
    progs = {"live": {"id": "live", "name": "案件", "url": "https://x.example/a", "cta": "見る"}}
    body = "導入 {{aff:live|公式}}\n\n## 一\n" + "あ" * 200 + "\n\n## 二\n" + "い" * 2000 + "\n\n{{aff:live}}\n\n## 三\nおわり"
    out = with_early_cta(body, progs)
    assert out.index("{{aff:live}}\n") < out.index("## 二")


def test_unlinked_cta_routes_to_related_article():
    from engine.links import route_unlinked_ctas
    target = {"title": "関連記事", "url": "https://s.example/articles/x/", "audience": "迷っている方へ",
              "thumb": "https://s.example/articles/x/thumb.webp"}
    body = "A {{aff:b|詳細}}\n\n{{aff:b}}\n\nB\n\n{{aff:a}}\n\n{{aff:b}}"
    out = route_unlinked_ctas(body, PROGRAMS, target)
    assert out.count("next-step") >= 1 and out.count('class="next-step"') == 1
    assert "{{aff:a}}" in out and "{{aff:b|詳細}}" in out and "{{aff:b}}" not in out
    assert "{{aff:b}}" not in route_unlinked_ctas(body, PROGRAMS, None)
