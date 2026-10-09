"""本文中のショートコード {{aff:ID}} / {{aff:ID|文言}} をアフィリエイトリンクに展開する。"""
from __future__ import annotations

import html
import re

SHORTCODE_RE = re.compile(r"\{\{aff:([a-z0-9-]+)(?:\|([^}]+))?\}\}")


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
    """Markdown 変換前に呼ぶ。未知のIDや未提携（url空）の案件はリンクなしで表示する。"""

    def replace(m: re.Match) -> str:
        pid, label = m.group(1), m.group(2)
        program = programs.get(pid)
        if program is None:
            return html.escape(label or "")
        url = (program.get("url") or "").strip()
        pixel = (program.get("pixel") or "").strip()
        banner = (program.get("banner") or "").strip()
        if label:  # 文中リンク（バナー広告しかない案件は、広告コードを作り替えないよう文字だけにする）
            return _anchor(url, label, pixel) if url and not banner else html.escape(label)
        name = html.escape(program["name"])
        if url and banner:
            w, h = int(program.get("banner_width") or 0), int(program.get("banner_height") or 0)
            size = f' width="{w}" height="{h}"' if w and h else ""
            tracker = (f'<img class="aff-pixel" src="{html.escape(pixel, quote=True)}" width="1" height="1" alt="">'
                       if pixel else "")
            return (
                f'\n\n<div class="cta-box"><span class="cta-label">PR</span><p class="cta-name">{name}</p>'
                f'<a class="cta-banner" href="{html.escape(url, quote=True)}" rel="sponsored noopener" '
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
