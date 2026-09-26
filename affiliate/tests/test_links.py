from engine.links import expand_shortcodes, find_shortcodes

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
