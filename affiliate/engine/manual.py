"""Claude Code の Routine（月額プランの利用枠で動くクラウドセッション）から記事を書くためのコマンド群。

API キーを使わず、セッション内の Claude 自身が調査・執筆し、ここのコマンドで
「次のテーマの取得 → 品質チェック → 公開済みとして記録」を行う。

  python -m engine guide                 執筆ルール（編集方針・図解ブロック・案件ID）を表示
  python -m engine next [--n 1]          次に書くテーマと、内部リンクできる既存記事を JSON で表示
  python -m engine validate FILE         記事ファイル1本に品質ゲートをかける（不合格なら終了コード1）
  python -m engine publish FILE --keyword K   合格した記事を公開済みとして記録（テーマ在庫・ログ・STATUS を更新）
  python -m engine reject --keyword K --reason R   書けなかったテーマを見送りにする
  python -m engine add-keywords FILE.json     新しいテーマ候補を在庫に追加（重複・不正な案件IDは除外）
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from . import prompts
from .articles import load_articles, parse_article
from .config import RUN_LOG_FILE, Config
from .planner import KeywordQueue, normalize
from .quality import check_article

BLOCK_GUIDE = """
# 記事ファイルの形式（content/articles/<slug>.md）
---
title: 28〜36字のタイトル
slug: short-english-words
description: 80〜120字の説明
category: school | career | tools | learning
tags: [タグ, タグ]
keyword: 狙う検索キーワード（next で受け取ったもの）
programs: [本文で使った案件ID]
published: 'YYYY-MM-DD'
updated: 'YYYY-MM-DD'
origin: ai
editor_score: null
sources:
- title: 実際に開いて確認したページのタイトル
  url: https://...
---
本文（Markdown。H1 は書かない）

# 図解ブロック（3〜6個）
:::summary / :::point 見出し / :::warning 見出し / :::check 見出し / :::merit / :::demerit / :::steps 見出し
（中身を書いて ::: だけの行で閉じる。steps の中身は「1. **名前**：説明」の番号付きリスト）

# ショートコード
{{aff:案件ID}} … CTAボックス（2〜4箇所）　{{aff:案件ID|文言}} … 文中リンク
{{link:既存記事slug}} … 内部リンク（next が返した既存記事のみ、1〜3本）
"""


def cmd_guide(cfg: Config, args) -> int:
    print(prompts.editorial_system(cfg))
    print(BLOCK_GUIDE)
    return 0


def cmd_next(cfg: Config, args) -> int:
    queue = KeywordQueue()
    queue.rescore(cfg.programs_by_id)
    queue.save()
    items = [
        {k: i.get(k) for k in ("keyword", "intent", "category", "program")}
        for i in queue.queued[: args.n]
    ]
    existing = [{"slug": a.slug, "title": a.title, "category": a.category} for a in load_articles()]
    print(json.dumps({
        "today": datetime.now(timezone.utc).date().isoformat(),
        "next": items,
        "queued_remaining": len(queue.queued),
        "existing_articles": existing,
        "program_ids": list(cfg.programs_by_id),
        "categories": list(cfg.category_names),
    }, ensure_ascii=False, indent=1))
    return 0


def _report(cfg: Config, path: Path):
    article = parse_article(path.read_text(encoding="utf-8"))
    others = [a for a in load_articles() if a.slug != article.slug]
    report = check_article(article, quality=cfg.quality, programs=cfg.programs_by_id,
                           categories=set(cfg.category_names), existing=others)
    if path.stem != article.slug:
        report.issues.append(f"ファイル名（{path.stem}.md）と slug（{article.slug}）が一致していません")
    return article, report


def cmd_validate(cfg: Config, args) -> int:
    article, report = _report(cfg, Path(args.file))
    if report.passed:
        print(f"OK {article.slug}（{report.char_count}字）")
        return 0
    print(f"NG {article.slug}")
    for issue in report.issues:
        print(f"- {issue}")
    return 1


def _log(entry: dict) -> None:
    RUN_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with RUN_LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def cmd_publish(cfg: Config, args) -> int:
    from .cli import write_status

    article, report = _report(cfg, Path(args.file))
    if not report.passed:
        print("品質ゲート不合格のため記録しません:")
        for issue in report.issues:
            print(f"- {issue}")
        return 1
    queue = KeywordQueue()
    key = normalize(args.keyword)
    item = next((i for i in queue.items if normalize(i["keyword"]) == key), None)
    if item is None:
        item = {"keyword": args.keyword, "intent": "commercial", "category": article.category,
                "program": (article.programs or [""])[0], "score": 0}
        queue.items.append(item)
    item["status"] = "published"
    item["slug"] = article.slug
    item.pop("issues", None)
    queue.rescore(cfg.programs_by_id)
    queue.save()
    _log({"ts": _now(), "source": "routine", "published": [article.slug], "refreshed": [], "rejected": [],
          "errors": []})
    write_status(cfg)
    print(f"公開済みとして記録しました: {article.slug}")
    return 0


def cmd_reject(cfg: Config, args) -> int:
    from .cli import write_status

    queue = KeywordQueue()
    key = normalize(args.keyword)
    for item in queue.items:
        if normalize(item["keyword"]) == key:
            item["status"] = "rejected"
            item["issues"] = [args.reason]
            break
    else:
        print(f"在庫にないテーマです: {args.keyword}")
        return 1
    queue.save()
    _log({"ts": _now(), "source": "routine", "published": [], "refreshed": [], "rejected": [args.keyword],
          "errors": [args.reason]})
    write_status(cfg)
    return 0


def cmd_add_keywords(cfg: Config, args) -> int:
    candidates = json.loads(Path(args.file).read_text(encoding="utf-8"))
    if isinstance(candidates, dict):
        candidates = candidates.get("keywords", [])
    queue = KeywordQueue()
    added = queue.add([c for c in candidates if c.get("intent") in ("transactional", "commercial", "informational")],
                      cfg)
    queue.rescore(cfg.programs_by_id)
    queue.save()
    print(f"{added} 件追加しました（在庫 {len(queue.queued)} 件）")
    return 0


def register(sub) -> dict:
    sub.add_parser("guide")
    p = sub.add_parser("next")
    p.add_argument("--n", type=int, default=1)
    p = sub.add_parser("validate")
    p.add_argument("file")
    p = sub.add_parser("publish")
    p.add_argument("file")
    p.add_argument("--keyword", required=True)
    p = sub.add_parser("reject")
    p.add_argument("--keyword", required=True)
    p.add_argument("--reason", required=True)
    p = sub.add_parser("add-keywords")
    p.add_argument("file")
    return {
        "guide": cmd_guide,
        "next": cmd_next,
        "validate": cmd_validate,
        "publish": cmd_publish,
        "reject": cmd_reject,
        "add-keywords": cmd_add_keywords,
    }
