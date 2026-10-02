from engine.ads import guess_asp, parse_ad_code, update_program
from engine.links import expand_shortcodes

A8_CODE = """<a href="https://px.a8.net/svt/ejp?a8mat=ABC123+DEF" rel="nofollow">テキスト</a>
<img border="0" width="1" height="1" src="https://www13.a8.net/0.gif?a8mat=ABC123+DEF" alt="">"""

MOSHIMO_CODE = (
    '<a href="//af.moshimo.com/af/c/click?a_id=1&amp;p_id=2&amp;pc_id=3&amp;pl_id=4&amp;url=https%3A%2F%2Fexample.com"'
    ' rel="nofollow" referrerpolicy="no-referrer-when-downgrade" attributionsrc>テキスト</a>'
    '<img src="//i.moshimo.com/af/i/impression?a_id=1&amp;p_id=2&amp;pc_id=3&amp;pl_id=4" width="1" height="1"'
    ' style="border:none;" loading="lazy">'
)

PROGRAMS_YAML = """# コメント
programs:
  - id: school-general
    name: "スクール"
    asp: ""
    url: ""
    est_reward_jpy: 10000

  - id: tools-domain
    name: "ドメイン"
    asp: ""
    url: ""
"""


def test_parse_a8_code():
    url, pixel = parse_ad_code(A8_CODE)
    assert url == "https://px.a8.net/svt/ejp?a8mat=ABC123+DEF"
    assert pixel == "https://www13.a8.net/0.gif?a8mat=ABC123+DEF"
    assert guess_asp(url) == "a8"


def test_parse_moshimo_code_unescapes_and_adds_scheme():
    url, pixel = parse_ad_code(MOSHIMO_CODE)
    assert url.startswith("https://af.moshimo.com/af/c/click?a_id=1&p_id=2")
    assert pixel.startswith("https://i.moshimo.com/af/i/impression?a_id=1&p_id=2")
    assert guess_asp(url) == "moshimo"


def test_parse_bare_url():
    assert parse_ad_code("  https://px.a8.net/svt/ejp?a8mat=X \n") == ("https://px.a8.net/svt/ejp?a8mat=X", "")


def test_update_program_only_touches_target_block():
    out = update_program(PROGRAMS_YAML, "school-general",
                         {"asp": "a8", "url": "https://px.a8.net/x", "pixel": "https://www13.a8.net/0.gif?a8mat=x"})
    assert out.startswith("# コメント")
    assert '    url: "https://px.a8.net/x"\n    pixel: "https://www13.a8.net/0.gif?a8mat=x"\n' in out
    assert '    asp: "a8"' in out
    assert out.count('url: ""') == 1  # tools-domain はそのまま
    again = update_program(out, "school-general", {"url": "https://px.a8.net/y", "pixel": ""})
    assert again.count("pixel:") == 1 and 'url: "https://px.a8.net/y"' in again


def test_pixel_is_rendered_next_to_link():
    programs = {"p": {"id": "p", "name": "案件", "url": "https://px.a8.net/x", "pixel": "https://www13.a8.net/0.gif?a8mat=x",
                      "cta": "公式サイト"}}
    box = expand_shortcodes("{{aff:p}}", programs)
    assert 'class="cta-button"' in box and 'class="aff-pixel" src="https://www13.a8.net/0.gif?a8mat=x"' in box
    assert 'rel="sponsored noopener"' in expand_shortcodes("{{aff:p|詳細}}", programs)
