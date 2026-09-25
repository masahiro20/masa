"""本文中のショートコード {{aff:ID}} / {{aff:ID|文言}} をアフィリエイトリンクに展開する。"""
from __future__ import annotations

import html
import re

SHORTCODE_RE = re.compile(r"\{\{aff:([a-z0-9-]+)(?:\|([^}]+))?\}\}")


def find_shortcodes(body: str) -> list[str]:
    return [m.group(1) for m in SHORTCODE_RE.finditer(body)]


def _anchor(url: str, text: str) -> str:
    return (
        f'<a href="{html.escape(url, quote=True)}" rel="sponsored noopener" '
        f'target="_blank">{html.escape(text)}</a>'
    )


def expand_shortcodes(body: str, programs: dict[str, dict]) -> str:
    """Markdown 変換前に呼ぶ。未知のIDや未提携（url空）の案件はリンクなしで表示する。"""

    def replace(m: re.Match) -> str:
        pid, label = m.group(1), m.group(2)
        program = programs.get(pid)
        if program is None:
            return html.escape(label or "")
        url = (program.get("url") or "").strip()
        if label:  # 文中リンク
            return _anchor(url, label) if url else html.escape(label)
        name = html.escape(program["name"])
        cta = program.get("cta") or "公式サイトを見る"
        button = (
            _anchor(url, cta).replace("<a ", '<a class="cta-button" ', 1)
            if url
            else f'<span class="cta-button is-disabled">{html.escape(cta)}</span>'
        )
        # 前後を空行で囲み、Markdown の段落と混ざらない HTML ブロックにする
        return (
            f'\n\n<div class="cta-box"><span class="cta-label">PR</span>'
            f'<p class="cta-name">{name}</p>{button}</div>\n\n'
        )

    return SHORTCODE_RE.sub(replace, body)
