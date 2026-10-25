"""本文中のショートコード {{aff:ID}} / {{aff:ID|文言}} をアフィリエイトリンクに展開する。"""
from __future__ import annotations

import html
import re

SHORTCODE_RE = re.compile(r"\{\{aff:([a-z0-9-]+)(?:\|([^}]+))?\}\}")


def with_early_cta(body: str, programs: dict[str, dict], threshold: float = 0.4) -> str:
    """広告が入っている案件の CTA が記事の後半にしかない場合、最初の節の直後にも同じ案件の CTA を足す。

    読者の多くは記事の後半まで読まないため、最初の広告が 40% より後ろにあると押される機会を逃す。
    本文のファイルは変えず、サイトを生成するときだけ挿入する（広告が未設定の案件は対象外）。
    """
    live = {pid for pid, p in programs.items() if (p.get("url") or "").strip()}
    first = next((m for m in SHORTCODE_RE.finditer(body) if m.group(1) in live), None)
    # 文中リンクより目に入りやすい CTA ボックスの位置で判断する
    first_box = next((m for m in SHORTCODE_RE.finditer(body) if m.group(1) in live and not m.group(2)), None)
    if first is None or (first_box is not None and first_box.start() < threshold * len(body)):
        return body
    first = first_box or first
    heads = [m.start() for m in re.finditer(r"(?m)^## ", body)]
    if len(heads) < 2 or heads[1] > threshold * len(body):
        return body
    return body[: heads[1]] + "{{aff:%s}}\n\n" % first.group(1) + body[heads[1]:]


def route_unlinked_ctas(body: str, programs: dict[str, dict], target: dict | None) -> str:
    """まだ提携していない案件の CTA ボックスを、広告が入っている関連記事への案内に置き換える。

    未提携の案件は押せない灰色のボタンになり、「PR」と書かれた空の枠が読者の目線を止めてしまう。
    最初の1つだけを「あわせて読みたい」の記事カードにし、2つ目以降は出さない。
    target は {"title", "url", "audience", "thumb"}。None なら何も出さない。文中リンク（{{aff:ID|文言}}）はそのまま。
    """
    live = {pid for pid, p in programs.items() if (p.get("url") or "").strip()}
    shown = False

    def replace(m: re.Match) -> str:
        nonlocal shown
        pid, label = m.group(1), m.group(2)
        if label or pid in live or pid not in programs:
            return m.group(0)
        if shown or not target:
            return ""
        shown = True
        aud = (f'<span class="next-step-aud">{html.escape(target["audience"])}</span>'
               if target.get("audience") else "")
        return (
            f'\n\n<aside class="next-step"><p class="next-step-label">あわせて読みたい</p>'
            f'<a class="next-step-link" href="{html.escape(target["url"], quote=True)}">'
            f'<img src="{html.escape(target["thumb"], quote=True)}" alt="" width="640" height="336" loading="lazy" decoding="async">'
            f'<span class="next-step-text"><span class="next-step-title">{html.escape(target["title"])}</span>{aud}</span>'
            f'</a></aside>\n\n'
        )

    return SHORTCODE_RE.sub(replace, body)


def find_shortcodes(body: str) -> list[str]:
    return [m.group(1) for m in SHORTCODE_RE.finditer(body)]


def _anchor(url: str, text: str, pixel: str = "") -> str:
    # pixel は ASP の広告コードに含まれる 1×1 の表示回数計測用画像。規約上、リンクと一緒に残す
    tracker = (
        f'<img class="aff-pixel" src="{html.escape(pixel, quote=True)}" width="1" height="1" alt="">'
        if pixel else ""
    )
    return (
        f'<a href="{html.escape(url, quote=True)}" rel="sponsored noopener" '
        f'referrerpolicy="no-referrer-when-downgrade" target="_blank">{html.escape(text)}</a>{tracker}'
    )


def expand_shortcodes(body: str, programs: dict[str, dict]) -> str:
    """Markdown 変換前に呼ぶ。未知のIDや未提携（url空）の案件はリンクなしで表示する。

    案件の広告は2通りある。
    - テキスト広告（url / pixel）… 文中リンクとCTAボタンに使う。
    - バナー広告（banner / banner_width / banner_height）… CTAボックスに画像のまま表示する（コードは作り替えない）。
      バナーに専用のリンク（banner_url / banner_pixel）がある案件は、バナーを記事内の最初のCTAだけに出し、
      2回目以降はテキスト広告のボタンにする（広告だらけに見せない）。
      バナーしかない案件は、文中リンクを文字だけにし、CTAはバナーで表示する（同じ記事で3回以上あるときは最初と最後だけ）。
    """

    shown_banner: set[str] = set()
    cta_total: dict[str, int] = {}
    for mm in SHORTCODE_RE.finditer(body):
        if not mm.group(2):
            cta_total[mm.group(1)] = cta_total.get(mm.group(1), 0) + 1
    cta_seen: dict[str, int] = {}

    def replace(m: re.Match) -> str:
        pid, label = m.group(1), m.group(2)
        program = programs.get(pid)
        if program is None:
            return html.escape(label or "")
        url = (program.get("url") or "").strip()
        pixel = (program.get("pixel") or "").strip()
        banner = (program.get("banner") or "").strip()
        banner_url = (program.get("banner_url") or "").strip()
        has_text_ad = bool(url) and (not banner or bool(banner_url))
        if label:  # 文中リンク
            return _anchor(url, label, pixel) if has_text_ad else html.escape(label)
        name = html.escape(program["name"])
        cta_seen[pid] = cta_seen.get(pid, 0) + 1
        if banner and not banner_url and cta_total.get(pid, 0) > 2 and 1 < cta_seen[pid] < cta_total[pid]:
            return ""  # バナーしかない案件は、同じ画像を何度も並べない（最初と最後だけ）
        use_banner = bool(banner) and (banner_url or url) and not (banner_url and pid in shown_banner)
        if use_banner:
            shown_banner.add(pid)
            b_url = banner_url or url
            b_pixel = (program.get("banner_pixel") or "").strip() if banner_url else pixel
            w, h = int(program.get("banner_width") or 0), int(program.get("banner_height") or 0)
            size = f' width="{w}" height="{h}"' if w and h else ""
            tracker = (f'<img class="aff-pixel" src="{html.escape(b_pixel, quote=True)}" width="1" height="1" alt="">'
                       if b_pixel else "")
            return (
                f'\n\n<div class="cta-box"><span class="cta-label">PR</span><p class="cta-name">{name}</p>'
                f'<a class="cta-banner" href="{html.escape(b_url, quote=True)}" rel="sponsored noopener" '
                f'referrerpolicy="no-referrer-when-downgrade" target="_blank">'
                f'<img src="{html.escape(banner, quote=True)}"{size} alt="{name}" loading="lazy" decoding="async"></a>'
                f'{tracker}</div>\n\n'
            )
        cta = program.get("cta") or "公式サイトを見る"
        button = (
            _anchor(url, cta, pixel).replace("<a ", '<a class="cta-button" ', 1)
            if url
            else f'<span class="cta-button is-disabled">{html.escape(cta)}</span>'
        )
        # 前後を空行で囲み、Markdown の段落と混ざらない HTML ブロックにする
        return (
            f'\n\n<div class="cta-box"><span class="cta-label">PR</span>'
            f'<p class="cta-name">{name}</p>{button}</div>\n\n'
        )

    return SHORTCODE_RE.sub(replace, body)
