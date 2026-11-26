from datetime import date

from engine.schools import enrich, load_schools, validate
from engine.site import build_site


def test_schools_yaml_is_valid(cfg):
    schools = load_schools()
    assert schools, "config/schools.yaml に1校以上載せる"
    assert validate(schools, cfg.programs_by_id) == []


def test_validate_catches_missing_source_and_hold(cfg):
    programs = {"p-live": {"url": "https://example.com/a"}, "p-hold": {"url": "https://example.com/b", "hold": True}}
    bad = [{"id": "x", "name": "X", "official": "https://x.example", "program": "p-hold",
            "subsidies": [{"system": "senmon", "source": "", "checked": "2026/11/25"}]}]
    issues = validate(bad, programs)
    assert any("hold" in i for i in issues)
    assert any("source" in i for i in issues)
    assert any("checked" in i for i in issues)


def test_enrich_marks_ads_and_stale_entries():
    programs = {"p-live": {"url": "https://example.com/a", "pixel": "https://example.com/p", "cta": "見る"},
                "p-hold": {"url": "https://example.com/b", "hold": True}}
    schools = [
        {"id": "a", "name": "A", "official": "https://a.example", "program": "p-live", "fields": ["ai"], "format": ["online"],
         "subsidies": [{"system": "reskilling", "source": "https://a.example/s", "checked": "2026-01-01"}]},
        {"id": "b", "name": "B", "official": "https://b.example", "program": "p-hold",
         "subsidies": [{"system": "ippan", "source": "https://b.example/s", "checked": "2026-11-20"},
                       {"system": "senmon", "source": "https://b.example/s", "checked": "2026-11-20"}]},
    ]
    out = enrich(schools, programs, today=date(2026, 11, 25))
    assert [s["id"] for s in out] == ["b", "a"]  # 制度の多い順。広告の有無では並べない
    a = next(s for s in out if s["id"] == "a")
    b = next(s for s in out if s["id"] == "b")
    assert a["ad"]["url"] == "https://example.com/a" and b["ad"] is None  # 保管のみの案件は広告にしない
    assert a["subsidies"][0]["stale"] and not b["subsidies"][0]["stale"]
    assert a["field_names"] == ["AI・生成AI"] and a["format_names"] == ["オンライン"]


def test_school_page_and_llms_txt_are_built(cfg, good_article, tmp_path):
    build_site(cfg, articles=[good_article], out_dir=tmp_path / "public")
    page = (tmp_path / "public" / "tools" / "kyufukin-school" / "index.html").read_text(encoding="utf-8")
    n = len(load_schools())
    assert f"公式ページで確認した{n}校" in page and "{n}" not in page
    assert '"ItemList"' in page and '"FAQPage"' in page
    assert page.count('class="school-card"') == n
    assert "公式ページの記載を見る" in page
    llms = (tmp_path / "public" / "llms.txt").read_text(encoding="utf-8")
    assert "/tools/kyufukin-school/" in llms and llms.startswith("# ")


def test_school_detail_and_theme_pages(cfg, good_article, tmp_path):
    info = build_site(cfg, articles=[good_article], out_dir=tmp_path / "public")
    schools = load_schools()
    for sc in schools:
        page = (tmp_path / "public" / "tools" / "kyufukin-school" / sc["id"] / "index.html").read_text(encoding="utf-8")
        assert '"FAQPage"' in page and '"BreadcrumbList"' in page
        assert "公式ページの記載を見る" in page
        assert any(u.endswith(f"/tools/kyufukin-school/{sc['id']}/") for u in info["urls"])
    theme_slugs = [th["slug"] for t in cfg.niche["tools"] if t.get("data") == "schools" for th in t.get("themes", [])]
    assert not set(theme_slugs) & {sc["id"] for sc in schools}, "まとめページの slug がスクールの id と重なっている"
    assert (tmp_path / "public" / "tools" / "kyufukin-school" / "ai" / "index.html").exists()
