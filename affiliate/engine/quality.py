"""公開前の自動品質ゲート。人間の編集者の代わりに、機械的に判定できる基準をすべてチェックする。

ここで弾くもの:
- 薄い・構成の弱い記事（文字数・見出し数）
- 根拠のない記事（出典URLの不足）
- 実際には体験していない「使ってみた」系の捏造表現（景品表示法・Googleのガイドライン上のリスク）
- 誇大・断定表現（「必ず稼げる」「絶対」「業界No.1」など）
- 既存記事とほぼ同じ内容（重複コンテンツ）
- 未知のアフィリエイトIDや、埋め忘れのプレースホルダ
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

from .articles import SLUG_RE, Article
from .blocks import count_blocks, find_links
from .links import find_shortcodes

# 実体験を装う表現（AIは実際に受講・利用していないため禁止）
FAKE_EXPERIENCE_PATTERNS = [
    r"(私|僕|筆者|わたし|ぼく)(が|は|も)?(実際に)?(受講|利用|使っ|試し|申し込|契約|登録|転職)",
    r"実際に(受講|利用|使っ|試し|申し込|契約)して(み|わか|分か)",
    r"使ってみた(結果|感想|ところ)",
]

# 断定・誇大表現（景品表示法の優良誤認・有利誤認につながりやすい）
RISKY_CLAIM_PATTERNS = [
    r"必ず(稼げ|儲か|転職でき|受かる|成功)",
    r"絶対に?(稼げ|儲か|転職でき|おすすめ|損しない)",
    r"誰でも(簡単に)?(稼げ|月\d+万)",
    r"(業界|日本)(No\.?1|ナンバーワン|一|最大)",
    r"100%(稼げ|転職|成功|満足)",
    r"確実に(稼げ|儲か|転職)",
]

PLACEHOLDER_PATTERNS = [r"〇〇", r"○○", r"XXX", r"\[要確認\]", r"TODO", r"（ここに", r"lorem ipsum"]


@dataclass
class QualityReport:
    issues: list[str]
    char_count: int

    @property
    def passed(self) -> bool:
        return not self.issues


def plain_text(body: str) -> str:
    text = re.sub(r"\{\{aff:[^}]+\}\}", "", body)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[#>*_`|\-]", "", text)
    return re.sub(r"\s+", "", text)


def ngrams(text: str, n: int = 3) -> set[str]:
    return {text[i : i + n] for i in range(max(len(text) - n + 1, 0))}


def similarity(a: str, b: str) -> float:
    ga, gb = ngrams(plain_text(a)), ngrams(plain_text(b))
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / len(ga | gb)


def check_article(
    article: Article,
    *,
    quality: dict,
    programs: dict[str, dict],
    categories: set[str],
    existing: list[Article],
) -> QualityReport:
    issues: list[str] = []
    body = article.body
    text = plain_text(body)
    chars = len(text)

    if chars < quality["min_chars"]:
        issues.append(f"本文が短すぎます（{chars}字 < {quality['min_chars']}字）")
    if chars > quality["max_chars"]:
        issues.append(f"本文が長すぎます（{chars}字 > {quality['max_chars']}字）")

    h2 = len(re.findall(r"^## ", body, re.M))
    if h2 < quality["min_h2"]:
        issues.append(f"H2見出しが少なすぎます（{h2}個 < {quality['min_h2']}個）")
    if re.search(r"^# ", body, re.M):
        issues.append("本文にH1（# 見出し）を含めないでください。タイトルは自動でH1になります")

    if not 20 <= len(article.title) <= 60:
        issues.append(f"タイトルは20〜60字にしてください（現在{len(article.title)}字）")
    if not 50 <= len(article.description) <= 160:
        issues.append(f"ディスクリプションは50〜160字にしてください（現在{len(article.description)}字）")
    if not SLUG_RE.match(article.slug):
        issues.append(f"slug は半角英小文字・数字・ハイフンのみにしてください: {article.slug}")
    if article.category not in categories:
        issues.append(f"未知のカテゴリです: {article.category}")

    valid_sources = [
        s for s in article.sources
        if urlparse(str(s.get("url", ""))).scheme in ("http", "https") and urlparse(str(s.get("url", ""))).netloc
    ]
    if article.origin == "ai" and len(valid_sources) < quality["min_sources"]:
        issues.append(f"出典URLが不足しています（{len(valid_sources)}件 < {quality['min_sources']}件）")

    codes = find_shortcodes(body)
    unknown = sorted({c for c in codes if c not in programs})
    if unknown:
        issues.append(f"未知のアフィリエイトIDがあります: {', '.join(unknown)}")
    if not codes:
        issues.append("アフィリエイトのショートコード {{aff:ID}} が1つもありません")
    elif len(codes) > 6:
        issues.append(f"アフィリエイトリンクが多すぎます（{len(codes)}個 > 6個）。読者の役に立つ位置に絞ってください")

    if article.origin == "ai":
        blocks = count_blocks(body)
        if blocks < quality.get("min_blocks", 0):
            issues.append(f"図解ブロック（:::summary / :::point など）が少なすぎます（{blocks}個 < {quality['min_blocks']}個）")
    known_slugs = {a.slug for a in existing}
    bad_links = sorted({s for s in find_links(body) if s not in known_slugs or s == article.slug})
    if bad_links:
        issues.append(f"存在しない記事・自分自身への内部リンクがあります: {', '.join(bad_links)}")
    if len(re.findall(r"^:::", body, re.M)) % 2:
        issues.append("図解ブロックの閉じ忘れ（:::）があります")

    for pattern in FAKE_EXPERIENCE_PATTERNS:
        m = re.search(pattern, body)
        if m:
            issues.append(f"実体験を装う表現は禁止です: 「{m.group(0)}」")
    for pattern in RISKY_CLAIM_PATTERNS:
        m = re.search(pattern, body)
        if m:
            issues.append(f"断定・誇大表現は禁止です: 「{m.group(0)}」")
    for pattern in PLACEHOLDER_PATTERNS:
        m = re.search(pattern, body, re.I)
        if m:
            issues.append(f"プレースホルダが残っています: 「{m.group(0)}」")

    for other in existing:
        if other.slug == article.slug:
            continue
        if other.title == article.title:
            issues.append(f"既存記事とタイトルが重複しています: {other.slug}")
        sim = similarity(body, other.body)
        if sim > quality["max_similarity"]:
            issues.append(f"既存記事「{other.slug}」と内容が似すぎています（類似度 {sim:.2f}）")

    return QualityReport(issues=issues, char_count=chars)
