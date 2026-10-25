"""記事から静的サイト（HTML / アイキャッチ画像 / sitemap / RSS / robots）を生成する。"""
from __future__ import annotations

import hashlib
import html
import json
import re
import shutil
from datetime import date, datetime, timezone
from email.utils import format_datetime
from pathlib import Path

import markdown
import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape

from .articles import Article, load_articles
from .blocks import expand_links, extract_faq, render_blocks
from .config import PAGES_DIR, PUBLIC_DIR, STATIC_DIR, TEMPLATES_DIR, Config
from .links import expand_shortcodes, with_early_cta
from .visuals import logo_png, logo_svg, save_cover, site_cover

COVER_NAME = "cover.png"


def indexnow_key(base_url: str) -> str:
    """サイトURLから決まる固定キー（IndexNow の所有確認に使う公開値）。"""
    return hashlib.sha256(f"indexnow:{base_url}".encode()).hexdigest()[:32]


def _slugify(value: str, separator: str) -> str:
    return "h-" + hashlib.md5(value.encode()).hexdigest()[:8]


def render_markdown(body: str, programs: dict[str, dict],
                    link_targets: dict[str, tuple[str, str]] | None = None) -> tuple[str, str]:
    md = markdown.Markdown(
        extensions=["tables", "toc", "fenced_code", "sane_lists", "attr_list"],
        extension_configs={"toc": {"toc_depth": "2-2", "permalink": False, "slugify": _slugify}},
    )
    text = expand_links(body, link_targets or {})
    text = render_blocks(expand_shortcodes(text, programs))
    html_body = md.convert(text)
    # 本文中の外部リンク（アフィリエイト以外）は新しいタブ・noopener
    html_body = re.sub(
        r'<a href="(https?://[^"]+)">',
        r'<a href="\1" target="_blank" rel="noopener">',
        html_body,
    )
    # 表は横スクロールできる枠で包む（スマホで崩れないように）
    html_body = html_body.replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>")
    return html_body, md.toc


def related_articles(article: Article, articles: list[Article], n: int = 4) -> list[Article]:
    def overlap(other: Article) -> tuple[int, str]:
        s = len(set(article.tags) & set(other.tags)) * 2 + (other.category == article.category)
        return (s, other.published)

    others = [a for a in articles if a.slug != article.slug]
    others.sort(key=overlap, reverse=True)
    return others[:n]


def _tokens(a: Article) -> set[str]:
    text = f"{a.title} {a.keyword or ''} {' '.join(a.tags)}"
    return {text[i:i + 2] for i in range(len(text) - 1) if text[i].strip() and text[i + 1].strip()}


def related_map(articles: list[Article], n: int = 5) -> dict[str, list[Article]]:
    """全記事の関連記事を一度に決める。似ている順に選びつつ、まだリンクを受けていない記事を優先する。

    似ている記事ばかりを選ぶと、特定の記事に被リンクが偏り、新しい記事が「どこからもリンクされない」
    状態になる（検索エンジンの巡回が届きにくい）。そのため、すでに多く選ばれた記事には減点をかける。
    """
    toks = {a.slug: _tokens(a) for a in articles}

    def sim(a: Article, b: Article) -> float:
        ta, tb = toks[a.slug], toks[b.slug]
        jac = len(ta & tb) / max(1, len(ta | tb))
        return jac * 10 + len(set(a.tags) & set(b.tags)) * 2 + (1.5 if a.category == b.category else 0)

    inbound = {a.slug: 0 for a in articles}
    result: dict[str, list[Article]] = {}
    # リンクが集まりにくい新しい記事から順に割り当てる
    for a in sorted(articles, key=lambda x: (x.published or "", x.slug), reverse=True):
        scored = sorted(
            (b for b in articles if b.slug != a.slug),
            key=lambda b: sim(a, b) - 1.2 * inbound[b.slug] + (3 if inbound[b.slug] == 0 else 0),
            reverse=True,
        )
        picked = scored[:n]
        for b in picked:
            inbound[b.slug] += 1
        result[a.slug] = picked
    return result


def pillar_articles(articles: list[Article], n: int = 6) -> list[Article]:
    """本文からリンクされている数が多い記事（サイトの軸になる記事）。フッターから全ページにリンクする。"""
    counts = {a.slug: 0 for a in articles}
    for a in articles:
        for target in re.findall(r"\{\{link:([a-z0-9-]+)", a.body):
            if target in counts and target != a.slug:
                counts[target] += 1
    ranked = sorted(articles, key=lambda a: (counts[a.slug], a.published or ""), reverse=True)
    return [a for a in ranked if counts[a.slug] > 0][:n]


def reading_minutes(body: str) -> int:
    chars = len(re.sub(r"\s|[#>*_`|:\-]|\{\{[^}]+\}\}", "", body))
    return max(1, round(chars / 600))


def _dump_ld(data) -> str:
    return json.dumps(data, ensure_ascii=False).replace("</", "<\\/")


def _organization(cfg: Config, base: str) -> dict:
    return {
        "@type": "Organization",
        "name": cfg.site["name"],
        "alternateName": cfg.site.get("name_en", ""),
        "url": f"{base}/",
        "logo": {"@type": "ImageObject", "url": f"{base}/static/logo.png"},
    }


def _article_ld(article: Article, cfg: Config, url: str, category_name: str, image: str, base: str) -> str:
    data = [
        {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": article.title,
            "description": article.description,
            "image": [image],
            "datePublished": article.published,
            "dateModified": article.updated or article.published,
            "author": {"@type": "Organization", "name": cfg.site["operator_name"], "url": f"{base}/about/"},
            "publisher": _organization(cfg, base),
            "mainEntityOfPage": url,
            "articleSection": category_name,
            "keywords": ", ".join(article.tags),
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "ホーム", "item": f"{base}/"},
                {"@type": "ListItem", "position": 2, "name": category_name,
                 "item": f"{base}/category/{article.category}/"},
                {"@type": "ListItem", "position": 3, "name": article.title, "item": url},
            ],
        },
    ]
    faqs = extract_faq(article.body)
    if faqs:
        data.append({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs
            ],
        })
    return _dump_ld(data)


def build_site(cfg: Config, *, articles: list[Article] | None = None, out_dir: Path = PUBLIC_DIR,
               pages_dir: Path = PAGES_DIR) -> dict:
    articles = load_articles() if articles is None else articles
    base = cfg.site["base_url"].rstrip("/")
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR), autoescape=select_autoescape(["html"]))
    cats = {c["slug"]: c for c in cfg.niche["categories"]}
    counts = {slug: sum(1 for a in articles if a.category == slug) for slug in cats}
    link_targets = {a.slug: (a.title, f"{base}/{a.url_path}") for a in articles}

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    shutil.copytree(STATIC_DIR, out_dir / "static")

    def write(rel: str, content: str) -> None:
        path = out_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    # ロゴ・ファビコン・サイト共通の OGP 画像
    brand_en = cfg.site.get("name_en", "")
    write("static/logo.svg", logo_svg(64, ring="#1b1b1b"))
    write("favicon.svg", logo_svg(64, ring="#1b1b1b"))
    site_cover(cfg.site["name"], cfg.site["tagline"], brand_en).save(
        out_dir / "static" / "og-default.png", "PNG", optimize=True)
    logo_png(256).save(out_dir / "static" / "logo.png", "PNG")

    def cover_url(a: Article) -> str:
        return f"{base}/{a.url_path}{COVER_NAME}"

    def cover_webp(a: Article) -> str:
        return f"{base}/{a.url_path}cover.webp"

    def thumb_url(a: Article) -> str:
        return f"{base}/{a.url_path}thumb.webp"

    common = {
        "site": cfg.site,
        "base_url": base,
        "categories": cats,
        "counts": counts,
        "year": date.today().year,
        "logo": logo_svg(34),
        "cover_url": cover_url,
        "cover_webp": cover_webp,
        "pillars": pillar_articles(articles),
        "thumb_url": thumb_url,
        "og_image": f"{base}/static/og-default.png",
    }
    urls: list[tuple[str, str]] = [(f"{base}/", articles[0].updated if articles else date.today().isoformat())]

    related_by_slug = related_map(articles)
    for a in articles:
        cat = cats.get(a.category, {"name": a.category, "color": "#162238", "slug": a.category})
        save_cover(out_dir / a.url_path / COVER_NAME, title=a.title, category_name=cat["name"],
                   category_slug=a.category, color=cat["color"], site_name=cfg.site["name"], brand_en=brand_en)
        body_html, toc = render_markdown(with_early_cta(a.body, cfg.programs_by_id), cfg.programs_by_id, link_targets)
        url = f"{base}/{a.url_path}"
        write(f"{a.url_path}index.html", env.get_template("article.html").render(
            **{**common, "og_image": cover_url(a)}, article=a, body=body_html, toc=toc, url=url, category=cat,
            related=related_by_slug[a.slug], minutes=reading_minutes(a.body),
            json_ld=_article_ld(a, cfg, url, cat["name"], cover_url(a), base),
            page_title=a.title, page_description=a.description, og_type="article",
        ))
        urls.append((url, a.updated or a.published))

    home_ld = _dump_ld([
        {"@context": "https://schema.org", "@type": "WebSite", "name": cfg.site["name"],
         "alternateName": cfg.site.get("name_en", ""), "url": f"{base}/",
         "description": cfg.site["tagline"], "inLanguage": "ja"},
        {"@context": "https://schema.org", **_organization(cfg, base)},
    ])
    write("index.html", env.get_template("index.html").render(
        **common, articles=articles, url=f"{base}/", page_title=None,
        page_description=cfg.site["tagline"], json_ld=home_ld,
    ))

    if articles:
        archive_url = f"{base}/articles/"
        write("articles/index.html", env.get_template("archive.html").render(
            **common, articles=articles, url=archive_url, page_title="記事一覧",
            page_description=f"{cfg.site['name']}の全{len(articles)}記事を、カテゴリ別にまとめた一覧です。",
        ))
        urls.append((archive_url, articles[0].updated or articles[0].published))

    for slug, cat in cats.items():
        items = [a for a in articles if a.category == slug]
        url = f"{base}/category/{slug}/"
        write(f"category/{slug}/index.html", env.get_template("category.html").render(
            **common, articles=items, url=url, category=cat, page_title=cat["name"],
            page_description=cat.get("description") or f"{cat['name']}に関する記事の一覧です。",
            noindex=not items,
        ))
        if items:
            urls.append((url, items[0].updated))

    for page_file in sorted(pages_dir.glob("*.md")):
        page = _parse_page(page_file.read_text(encoding="utf-8"), cfg)
        slug = page_file.stem
        page["slug"] = slug
        body_html, _ = render_markdown(page["body"], cfg.programs_by_id, link_targets)
        url = f"{base}/{slug}/"
        write(f"{slug}/index.html", env.get_template("page.html").render(
            **common, page=page, body=body_html, url=url,
            page_title=page["title"], page_description=page.get("description", page["title"]),
        ))
        urls.append((url, page.get("updated", date.today().isoformat())))

    write("404.html", env.get_template("page.html").render(
        **common, page={"title": "ページが見つかりません"}, url=f"{base}/404.html",
        body='<p>お探しのページは移動または削除された可能性があります。<a href="' + base + '/">トップページ</a>からお探しください。</p>',
        page_title="ページが見つかりません", page_description="", noindex=True,
    ))

    write("sitemap.xml", _sitemap(urls))
    write("feed.xml", _feed(cfg, base, articles[:20]))
    write("robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {base}/sitemap.xml\n")
    key = indexnow_key(base)
    write(f"{key}.txt", key)
    write(".nojekyll", "")
    return {"articles": len(articles), "urls": [u for u, _ in urls]}


def _parse_page(text: str, cfg: Config) -> dict:
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    meta = yaml.safe_load(m.group(1)) if m else {}
    body = m.group(2) if m else text
    # {{site.xxx}} を設定値で置き換える（運営者名・連絡先など）
    body = re.sub(r"\{\{site\.(\w+)\}\}", lambda mm: str(cfg.site.get(mm.group(1)) or "（準備中）"), body)
    return {**meta, "body": body}


def _sitemap(urls: list[tuple[str, str]]) -> str:
    rows = "\n".join(
        f"  <url><loc>{html.escape(u)}</loc><lastmod>{d}</lastmod></url>" for u, d in urls
    )
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows + "\n</urlset>\n")


def _feed(cfg: Config, base: str, articles: list[Article]) -> str:
    def rfc822(d: str) -> str:
        return format_datetime(datetime.fromisoformat(d).replace(tzinfo=timezone.utc))

    items = "\n".join(
        f"<item><title>{html.escape(a.title)}</title><link>{base}/{a.url_path}</link>"
        f"<guid>{base}/{a.url_path}</guid><pubDate>{rfc822(a.published)}</pubDate>"
        f"<description>{html.escape(a.description)}</description></item>"
        for a in articles
    )
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>'
            f"<title>{html.escape(cfg.site['name'])}</title><link>{base}/</link>"
            f"<description>{html.escape(cfg.site['tagline'])}</description><language>ja</language>\n"
            f"{items}\n</channel></rss>\n")
