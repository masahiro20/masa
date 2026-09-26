"""記事本文の「図解ブロック」と内部リンクを HTML に変換する。

書き方（Markdown の中で使う）:

    :::summary              ← この記事でわかること
    - 箇条書き
    :::

    :::point 見出し（省略可）   ← ポイント / warning（注意）/ check（チェックリスト）
    本文
    :::

    :::merit / :::demerit   ← メリット・デメリット（続けて書くと左右2列に並ぶ）

    :::steps 申込の流れ     ← 番号付きリストがステップ図になる
    1. **登録**：説明
    2. **面談**：説明
    :::

内部リンク: {{link:記事slug}} または {{link:記事slug|リンク文言}}
"""
from __future__ import annotations

import html
import re

import markdown

BLOCK_RE = re.compile(r"^:::(\w+)[ \t]*(.*?)[ \t]*\n(.*?)\n:::[ \t]*$", re.M | re.S)
LINK_RE = re.compile(r"\{\{link:([a-z0-9-]+)(?:\|([^}]+))?\}\}")

_ICON_PATHS = {
    "summary": '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
    "point": '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.5"/>',
    "warning": '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4"/><path d="M12 17v.5"/>',
    "check": '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    "merit": '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    "demerit": '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    "steps": '<path d="M4 18h5v-5h5V8h6"/><path d="M17 5l3 3-3 3"/>',
}
LABELS = {
    "summary": "この記事でわかること",
    "point": "ポイント",
    "warning": "注意",
    "check": "チェックリスト",
    "merit": "メリット",
    "demerit": "デメリット",
    "steps": "手順",
}
BLOCK_TYPES = set(LABELS)


def icon(kind: str) -> str:
    return (
        '<svg class="box-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{_ICON_PATHS[kind]}</svg>'
    )


def count_blocks(body: str) -> int:
    return sum(1 for m in BLOCK_RE.finditer(body) if m.group(1) in BLOCK_TYPES)


def find_links(body: str) -> list[str]:
    return [m.group(1) for m in LINK_RE.finditer(body)]


def expand_links(body: str, articles: dict[str, tuple[str, str]]) -> str:
    """{{link:slug}} を内部リンクにする。articles は slug → (タイトル, URL)。未知の slug は文言だけ残す。"""

    def replace(m: re.Match) -> str:
        slug, label = m.group(1), m.group(2)
        target = articles.get(slug)
        text = label or (target[0] if target else "")
        if not target:
            return html.escape(text)
        return f'<a class="internal-link" href="{html.escape(target[1], quote=True)}">{html.escape(text)}</a>'

    return LINK_RE.sub(replace, body)


def _inner_html(text: str) -> str:
    return markdown.markdown(text.strip(), extensions=["tables", "sane_lists"])


def _steps_html(text: str) -> str:
    items = re.split(r"^\s*\d+[.)．]\s+", text.strip(), flags=re.M)
    items = [i.strip() for i in items if i.strip()]
    if not items:
        return _inner_html(text)
    lis = "".join(
        f'<li><span class="flow-num">{n}</span><div class="flow-body">{_inner_html(item)}</div></li>'
        for n, item in enumerate(items, 1)
    )
    return f'<ol class="flow">{lis}</ol>'


def render_blocks(body: str) -> str:
    """Markdown 変換の前に呼ぶ。ブロックを HTML ブロックに置き換える（前後に空行を入れる）。"""

    def replace(m: re.Match) -> str:
        kind, title, inner = m.group(1), m.group(2), m.group(3)
        if kind not in BLOCK_TYPES:
            return m.group(0)
        label = html.escape(title or LABELS[kind])
        content = _steps_html(inner) if kind == "steps" else _inner_html(inner)
        return (
            f'\n\n<div class="box box-{kind}"><p class="box-title">{label}</p>'
            f'<div class="box-body">{content}</div></div>\n\n'
        )

    out = BLOCK_RE.sub(replace, body)
    # メリット・デメリットが続いていれば左右2列にまとめる
    return re.sub(
        r'(<div class="box box-merit">.*?</div></div>)\s*(<div class="box box-demerit">.*?</div></div>)',
        r'<div class="box-pair">\1\2</div>',
        out,
        flags=re.S,
    )


def extract_faq(body: str) -> list[tuple[str, str]]:
    """「## よくある質問」の ### 見出しと直後の本文を (質問, 回答) にする（FAQPage 構造化データ用）。"""
    m = re.search(r"^## よくある質問[^\n]*\n(.*?)(?=^## |\Z)", body, re.M | re.S)
    if not m:
        return []
    faqs = []
    for part in re.split(r"^### ", m.group(1), flags=re.M)[1:]:
        q, _, a = part.partition("\n")
        a = re.sub(r"\{\{[^}]+\}\}", "", a)
        a = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", a)
        a = re.sub(r"[*_`#>]", "", a)
        a = re.sub(r"\s+", " ", a).strip()
        q = q.strip().lstrip("Q").lstrip("：:.． ").strip()
        if q and a:
            faqs.append((q, a[:500]))
    return faqs
