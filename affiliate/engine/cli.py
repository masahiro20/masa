"""コマンドライン: python -m engine <command>

  autopilot  キーワード補充 → 記事生成 → 既存記事の改善 → サイト生成 まで全自動で実行
  build      サイトだけ生成（public/ に出力）
  check      全記事に品質ゲートをかける（CI用）
  ping       直近の autopilot で追加・更新したURLを IndexNow に通知（デプロイ後に実行）
  status     運用状況のレポート（data/STATUS.md）を更新
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone

from .articles import load_articles
from .config import DATA_DIR, RUN_LOG_FILE, Config, load_config
from .quality import check_article

log = logging.getLogger("engine")
CHANGED_FILE = DATA_DIR / "last_changed.json"
STATUS_FILE = DATA_DIR / "STATUS.md"


def _has_credentials() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def cmd_autopilot(cfg: Config, args) -> int:
    import anthropic

    from .llm import LLM, BudgetExceeded, RefusedError
    from .optimizer import fetch_gsc_pages, select_refresh_candidates
    from .planner import KeywordQueue, replenish
    from .writer import Writer

    ap = cfg.autopilot
    run = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "published": [], "refreshed": [],
           "rejected": [], "errors": []}
    changed: list[str] = []
    base = cfg.site["base_url"].rstrip("/")

    if not _has_credentials():
        log.warning("ANTHROPIC_API_KEY が未設定のため記事生成をスキップし、サイト生成のみ行います")
        run["errors"].append("ANTHROPIC_API_KEY 未設定")
    else:
        llm = LLM(ap["model"], ap["monthly_budget_usd"])
        writer = Writer(cfg, llm)
        queue = KeywordQueue()
        try:
            queue.rescore(cfg.programs_by_id)
            if len(queue.queued) < ap["min_queue_size"]:
                replenish(queue, cfg, llm)
                queue.rescore(cfg.programs_by_id)
            queue.save()

            for _ in range(args.articles if args.articles is not None else ap["articles_per_run"]):
                item = queue.next()
                if item is None:
                    break
                log.info("執筆: %s", item["keyword"])
                try:
                    result = writer.write(item)
                except anthropic.APIError as e:
                    # 認証・障害などテーマと無関係のエラー: テーマは在庫に残して今回は終了
                    log.error("API エラーのため今回の執筆を中断: %s", e)
                    run["errors"].append(f"API: {e}")
                    break
                except (RefusedError, RuntimeError, json.JSONDecodeError, KeyError) as e:
                    if isinstance(e, BudgetExceeded):
                        raise
                    log.error("執筆エラー: %s", e)
                    result = None
                    run["errors"].append(f"{item['keyword']}: {e}")
                if result is not None and result.article is not None:
                    path = result.article.save()
                    item["status"] = "published"
                    item["slug"] = result.article.slug
                    run["published"].append(result.article.slug)
                    changed.append(f"{base}/{result.article.url_path}")
                    log.info("公開: %s (%s点)", path.name, result.article.editor_score)
                else:
                    item["status"] = "rejected"
                    item["issues"] = (result.issues if result else run["errors"][-1:])[:5]
                    run["rejected"].append(item["keyword"])
                queue.save()

            refresh_n = args.refresh if args.refresh is not None else ap["refresh_per_run"]
            if refresh_n:
                try:
                    gsc = fetch_gsc_pages()
                except Exception as e:  # noqa: BLE001 - GSC 障害で全体を止めない
                    log.warning("Search Console の取得に失敗: %s", e)
                    gsc = None
                candidates = select_refresh_candidates(
                    load_articles(), base_url=base, limit=refresh_n,
                    refresh_after_days=ap["refresh_after_days"], gsc=gsc,
                )
                for article, reason in candidates:
                    log.info("改善: %s（%s）", article.slug, reason)
                    try:
                        result = writer.refresh(article, reason)
                    except anthropic.APIError as e:
                        run["errors"].append(f"API: {e}")
                        break
                    except (RefusedError, RuntimeError, json.JSONDecodeError, KeyError) as e:
                        if isinstance(e, BudgetExceeded):
                            raise
                        run["errors"].append(f"refresh {article.slug}: {e}")
                        continue
                    if result.article is not None:
                        result.article.save()
                        run["refreshed"].append(article.slug)
                        changed.append(f"{base}/{article.url_path}")
                    else:
                        run["errors"].append(f"refresh {article.slug} 不合格: {result.issues[:3]}")
        except BudgetExceeded as e:
            log.warning("%s", e)
            run["errors"].append(str(e))
        except (anthropic.APIError, RefusedError, json.JSONDecodeError) as e:
            # キーワード補充などの失敗でもサイト生成・公開までは必ず進める
            log.error("生成処理を中断: %s", e)
            run["errors"].append(f"中断: {e}")
        queue.save()

    from .site import build_site

    info = build_site(cfg)
    log.info("サイト生成: %d記事", info["articles"])
    if changed:
        changed.append(f"{base}/")
    CHANGED_FILE.write_text(json.dumps(changed, ensure_ascii=False, indent=1), encoding="utf-8")
    with RUN_LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(run, ensure_ascii=False) + "\n")
    write_status(cfg)
    return 0


def cmd_build(cfg: Config, args) -> int:
    from .site import build_site

    info = build_site(cfg)
    print(f"public/ に {info['articles']} 記事・{len(info['urls'])} URL を出力しました")
    return 0


def cmd_check(cfg: Config, args) -> int:
    articles = load_articles()
    failed = 0
    for a in articles:
        report = check_article(a, quality=cfg.quality, programs=cfg.programs_by_id,
                               categories=set(cfg.category_names), existing=articles)
        if not report.passed:
            failed += 1
            print(f"NG {a.slug}: " + " / ".join(report.issues))
        else:
            print(f"OK {a.slug} ({report.char_count}字)")
    return 1 if failed else 0


def cmd_ping(cfg: Config, args) -> int:
    from .indexnow import ping

    urls = json.loads(CHANGED_FILE.read_text(encoding="utf-8")) if CHANGED_FILE.exists() else []
    ping(cfg.site["base_url"], urls)
    return 0  # 通知失敗で運用を止めない


def write_status(cfg: Config) -> None:
    from .llm import month_spend
    from .planner import KeywordQueue

    articles = load_articles()
    queue = KeywordQueue()
    runs = []
    if RUN_LOG_FILE.exists():
        runs = [json.loads(line) for line in RUN_LOG_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]
    linked = [p for p in cfg.programs if (p.get("url") or "").strip()]
    unlinked = [p for p in cfg.programs if not (p.get("url") or "").strip()]
    lines = [
        "# 運用ステータス（自動更新）",
        "",
        f"- 最終更新: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        f"- 公開記事数: {len(articles)}",
        f"- キーワード在庫: {len(queue.queued)}件（見送り {sum(1 for i in queue.items if i.get('status') == 'rejected')}件）",
        f"- 今月のAPI費用（概算）: ${month_spend():.2f} / 上限 ${cfg.autopilot['monthly_budget_usd']}",
        f"- 提携済み案件: {len(linked)} / {len(cfg.programs)}",
        "",
    ]
    if unlinked:
        lines += ["## 要対応: 広告リンク未設定の案件", "",
                  "ASPで提携したら `config/programs.yaml` の `url` に広告リンクを貼ってください。", ""]
        lines += [f"- `{p['id']}` {p['name']}" for p in unlinked]
        lines.append("")
    if runs:
        lines += ["## 直近の実行", "", "| 日時 | 公開 | 改善 | 見送り | エラー |", "|---|---|---|---|---|"]
        for r in runs[-10:][::-1]:
            errs = "; ".join(r.get("errors", []))[:120].replace("|", "/")
            lines.append(f"| {r['ts']} | {len(r['published'])} | {len(r['refreshed'])} | {len(r['rejected'])} | {errs} |")
        lines.append("")
    STATUS_FILE.write_text("\n".join(lines), encoding="utf-8")


def cmd_status(cfg: Config, args) -> int:
    write_status(cfg)
    print(STATUS_FILE.read_text(encoding="utf-8"))
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(prog="engine")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("autopilot")
    p.add_argument("--articles", type=int, default=None, help="今回生成する記事数（既定は設定値）")
    p.add_argument("--refresh", type=int, default=None, help="今回改善する既存記事数（既定は設定値）")
    for name in ("build", "check", "ping", "status"):
        sub.add_parser(name)
    args = parser.parse_args(argv)
    cfg = load_config()
    return {
        "autopilot": cmd_autopilot,
        "build": cmd_build,
        "check": cmd_check,
        "ping": cmd_ping,
        "status": cmd_status,
    }[args.command](cfg, args)


if __name__ == "__main__":
    sys.exit(main())
