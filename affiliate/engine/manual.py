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
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import gsc, prompts
from .articles import load_articles, parse_article
from .config import ARTICLES_DIR, RUN_LOG_FILE, Config
from .planner import KeywordQueue, normalize
from .quality import check_article

VOICE_REMINDER = (
    "人に寄り添う文章で書く（guide の17〜22）: 冒頭で読者の場面を『想定』として1〜2文描く／不安を1つ受け止める／"
    "編集部の考えを言い切る一文を入れる／表のあとに話し言葉で『結局どう考えるか』を添える／文末と長さに変化をつける／"
    "最後に選ばない自由にも触れた一言を添える。audience（誰のための記事か）を書き、descriptionをその一文で始める。体験談・読者の声は作らない。『お悩みではありませんか』『いかがでしたか』は禁止。"
)

BLOCK_GUIDE = """
# 記事ファイルの形式（content/articles/<slug>.md）
---
title: 28〜36字のタイトル
slug: short-english-words
audience: 誰のための記事か（8〜36字。例：40代で、未経験からIT転職を考えている方へ）
description: audience と同じ一文で始め、続けて記事の中身を書く（全体で80〜140字）
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

# テーマの重複（カニバリゼーション）を避ける
next のテーマが既存記事と同じ検索意図（言い回しが違うだけで、読者が知りたいことが同じ）なら、
新しく書かずに reject して（理由：既存記事◯◯と検索意図が重複）、次のテーマに進むこと。
同じ検索意図の記事が2本あると、検索エンジンがどちらを表示すべきか迷い、両方の順位が下がる。
"""


# この日付以降に公開された記事は、人に寄り添う書き方（guide の17〜22）で書かれているので書き直さない
VOICE_V2_DATE = "2026-10-26"

REWRITE_GUIDE = """既存記事の書き直し（読む人に寄り添う文章へ）
- 変えないもの: 事実・数字・料金・日付・出典・{{aff:…}} / {{link:…}} / :::ブロック。title・slug・keyword・description も原則そのまま（検索順位への影響を避けるため）。
- 直す箇所:
  (1) 冒頭（最初の ## より前、:::summary の前）を、読者がこの記事にたどり着いた場面を『想定』として1〜2文描く導入にする。結論は残す。
  (2) 表・箇条書きだけで終わる節に、2〜4文のやわらかい地の文（「結局どう考えればいいか」）を足す。
  (3) CTA（{{aff:…}}）の前後に、「編集部としては〜をおすすめします」と言い切る1文を入れ、よくある質問の前に、選ばない自由にも触れた結びの一言を入れる。
  (4) 「〜が挙げられます」「〜と言えるでしょう」「〜することが重要です」などの硬い言い回しを言い換える。文末と段落の長さに変化をつける。
  (5) 全体の長さは元の +10〜20% まで。
- 禁止: 体験談・読者の声・新しい数字や条件の追加。『お悩みではありませんか』『いかがでしたか』。広告ショートコードの数と位置を大きく変えること（合計2〜4個のまま）。
- focus があるとき（Search Console の数字で選ばれた記事。reason に理由）:
  ctr  … 上の「直す箇所」に加えて、title と description を書き直してよい。主キーワードは title の前半に残し、
          読者が得るもの（結論・数字・比較の軸）を具体的に示す。description は audience の一文で始めたまま。
  rank … title は変えない。冒頭で検索の答えを2〜3文で示し、足りない論点・比較表・よくある質問を補う（+30% まで可）。
- 手順: rewrite-next で対象を受け取る → 各記事を Read して上の方針で Edit → `python -m engine validate content/articles/<slug>.md` が OK になるまで直す →
  `python -m engine rewrite-done <slug> …` で記録 → ブランチ claude/articles-<日本時間YYYYMMDD>-rewrite を push（PR は作らない）。
"""


def _live_programs(cfg: Config) -> set[str]:
    return {pid for pid, p in cfg.programs_by_id.items() if (p.get("url") or "").strip()}


def cmd_rewrite_next(cfg: Config, args) -> int:
    live = _live_programs(cfg)
    articles = load_articles()
    todo = [a for a in articles if a.voice < 2 and (a.published or "") < VOICE_V2_DATE]

    def has_live_ad(a) -> bool:
        return any(pid in live for pid in re.findall(r"\{\{aff:([a-z0-9-]+)", a.body))

    # 広告が実際に入っている記事を先に、その中では古いものから
    todo.sort(key=lambda a: (not has_live_ad(a), a.published or "", a.slug))

    def target(a, op=None) -> dict:
        t = {"slug": a.slug, "title": a.title, "path": f"content/articles/{a.slug}.md", "category": a.category,
             "chars": len(a.body), "live_ad": has_live_ad(a)}
        if op:
            t.update({"focus": op["kind"], "reason": op["reason"]})
        return t

    # Search Console の数字があれば、伸ばしどころの記事（広告ありを優先）を先に回す
    by_slug = {a.slug: a for a in articles}
    ops = gsc.opportunities(articles, cfg.site["base_url"], gsc.load_pages())
    ops.sort(key=lambda o: not has_live_ad(by_slug[o["slug"]]))
    targets = [target(by_slug[o["slug"]], o) for o in ops[: args.n]]
    picked = {t["slug"] for t in targets}
    targets += [target(a) for a in todo if a.slug not in picked][: args.n - len(targets)]
    print(json.dumps({"targets": targets, "remaining": len(todo), "search_console_targets": len(ops),
                      "guide": REWRITE_GUIDE}, ensure_ascii=False, indent=1))
    return 0


def cmd_rewrite_done(cfg: Config, args) -> int:
    today = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
    status = 0
    for slug in args.slugs:
        path = ARTICLES_DIR / f"{slug}.md"
        if not path.exists():
            print(f"記事がありません: {slug}")
            status = 1
            continue
        _, report = _report(cfg, path)
        if not report.passed:
            print(f"品質ゲート不合格のため記録しません: {slug}")
            for issue in report.issues:
                print(f"- {issue}")
            status = 1
            continue
        text = path.read_text(encoding="utf-8")
        head, sep, body = text.partition("\n---\n")
        if "\nvoice:" not in head:
            head = re.sub(r"(\neditor_score:[^\n]*)", r"\1\nvoice: 2", head, count=1) if "\neditor_score:" in head else head + "\nvoice: 2"
        head = re.sub(r"(\nupdated: )[^\n]*", lambda m: f"{m.group(1)}'{today}'", head, count=1)
        path.write_text(head + sep + body, encoding="utf-8")
        print(f"書き直し済みとして記録しました: {slug}")
    return status


def cmd_guide(cfg: Config, args) -> int:
    print(prompts.editorial_system(cfg))
    print(BLOCK_GUIDE)
    return 0


def cmd_next(cfg: Config, args) -> int:
    queue = KeywordQueue()
    queue.rescore(cfg.programs_by_id)
    queue.save()
    articles = load_articles()
    items = [
        {k: i.get(k) for k in ("keyword", "intent", "category", "program")}
        for i in queue.pick(args.n, queue.recent_programs(articles))
    ]
    existing = [{"slug": a.slug, "title": a.title, "category": a.category} for a in articles]
    print(json.dumps({
        "today": datetime.now(timezone.utc).date().isoformat(),
        "next": items,
        "queued_remaining": len(queue.queued),
        "existing_articles": existing,
        "program_ids": list(cfg.programs_by_id),
        "voice_reminder": VOICE_REMINDER,
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
    p = sub.add_parser("rewrite-next")
    p.add_argument("--n", type=int, default=2)
    p = sub.add_parser("rewrite-done")
    p.add_argument("slugs", nargs="+")
    return {
        "guide": cmd_guide,
        "next": cmd_next,
        "validate": cmd_validate,
        "publish": cmd_publish,
        "reject": cmd_reject,
        "add-keywords": cmd_add_keywords,
        "rewrite-next": cmd_rewrite_next,
        "rewrite-done": cmd_rewrite_done,
    }
