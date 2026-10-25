"""Search Console の「検索パフォーマンス」をエクスポートしたファイルを取り込み、伸ばしどころの記事を選ぶ。

  python -m engine gsc-import FILE      エクスポートの ZIP（または中の「ページ.csv」「クエリ.csv」）を取り込む

Search Console → 検索パフォーマンス → 右上の「エクスポート」→「CSV をダウンロード」で得た ZIP をそのまま渡せる。
取り込んだ数字は data/gsc_pages.json / data/gsc_queries.json に保存され、`rewrite-next` が
「あと少しで1ページ目上位」「表示は多いのにクリックされない」記事を優先して書き直し対象にする。
"""
from __future__ import annotations

import csv
import io
import json
import zipfile
from datetime import date
from pathlib import Path

from .articles import Article
from .config import DATA_DIR

PAGES_FILE = DATA_DIR / "gsc_pages.json"
QUERIES_FILE = DATA_DIR / "gsc_queries.json"
MIN_DAYS_BETWEEN_UPDATES = 21

_COLS = {
    "clicks": ("クリック数", "clicks"),
    "impressions": ("表示回数", "impressions"),
    "ctr": ("ctr",),
    "position": ("掲載順位", "position"),
}


def _num(value: str) -> float:
    value = (value or "").strip().replace(",", "")
    if value.endswith("%"):
        return float(value[:-1] or 0) / 100
    return float(value or 0)


def parse_csv(text: str) -> tuple[str, dict[str, dict]]:
    """CSV の1列目（ページ or クエリ）をキーに数字を読む。返り値は ("pages"|"queries"|"", 行)。"""
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    if not rows:
        return "", {}
    header = [h.strip().lower() for h in rows[0]]
    first = header[0]
    kind = "pages" if ("ページ" in first or "page" in first) else "queries" if ("クエリ" in first or "quer" in first) else ""
    idx = {}
    for key, names in _COLS.items():
        idx[key] = next((i for i, h in enumerate(header) if any(n in h for n in names)), None)
    if not kind or any(v is None for v in idx.values()):
        return "", {}
    out = {}
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue
        out[r[0].strip()] = {k: _num(r[i]) if i < len(r) else 0.0 for k, i in idx.items()}
    return kind, out


def import_export(path: Path) -> dict[str, int]:
    files: list[tuple[str, str]] = []
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name.lower().endswith(".csv"):
                    files.append((name, z.read(name).decode("utf-8-sig", errors="replace")))
    else:
        files.append((path.name, path.read_text(encoding="utf-8-sig")))
    counts = {}
    today = date.today().isoformat()
    for _, text in files:
        kind, rows = parse_csv(text)
        if not kind:
            continue
        target = PAGES_FILE if kind == "pages" else QUERIES_FILE
        target.write_text(json.dumps({"imported": today, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
        counts[kind] = len(rows)
    return counts


def load_pages() -> dict[str, dict]:
    if not PAGES_FILE.exists():
        return {}
    return json.loads(PAGES_FILE.read_text(encoding="utf-8")).get("rows", {})


def _days_since(iso: str, today: date) -> int:
    try:
        return (today - date.fromisoformat(iso)).days
    except ValueError:
        return 10**6


def opportunities(articles: list[Article], base_url: str, pages: dict[str, dict],
                  today: date | None = None) -> list[dict]:
    """数字で見て、手を入れると伸びやすい記事。

    - rank: 平均順位 4〜20 位で表示がある → 中身を厚くして 1 ページ目上位へ
    - ctr : 1 ページ目に出ているのにクリック率が低い → タイトルと説明文を直す
    """
    today = today or date.today()
    base_url = base_url.rstrip("/")
    found = []
    for a in articles:
        m = pages.get(f"{base_url}/{a.url_path}")
        if not m or _days_since(a.updated or a.published, today) < MIN_DAYS_BETWEEN_UPDATES:
            continue
        imp, pos, ctr = m["impressions"], m["position"], m["ctr"]
        if imp >= 50 and pos <= 10 and ctr < 0.015:
            found.append({"slug": a.slug, "kind": "ctr", "impressions": imp, "position": round(pos, 1),
                          "reason": f"平均{pos:.1f}位・表示{int(imp)}回なのにクリック率{ctr * 100:.1f}%。"
                                    "タイトルと description を、検索した人が『自分の答えがある』と思える言葉に直す"})
        elif imp >= 30 and 4 <= pos <= 20:
            found.append({"slug": a.slug, "kind": "rank", "impressions": imp, "position": round(pos, 1),
                          "reason": f"平均{pos:.1f}位・表示{int(imp)}回。あと少しで1ページ目上位。"
                                    "検索意図への答えを冒頭で示し、足りない論点・比較表・よくある質問を補う"})
    found.sort(key=lambda x: x["impressions"], reverse=True)
    return found


def cmd_gsc_import(cfg, args) -> int:
    path = Path(args.file)
    if not path.exists():
        print(f"ファイルがありません: {path}")
        return 1
    counts = import_export(path)
    if not counts:
        print("Search Console のエクスポート（ページ / クエリの CSV）として読めませんでした")
        return 1
    print("取り込みました: " + "、".join(f"{'ページ' if k == 'pages' else 'クエリ'} {n}行" for k, n in counts.items()))
    if "pages" in counts:
        from .articles import load_articles
        ops = opportunities(load_articles(), cfg.site["base_url"], load_pages())
        print(f"伸ばしどころの記事: {len(ops)}本（rewrite-next で優先されます）")
        for o in ops[:10]:
            print(f"- {o['slug']}: {o['reason']}")
    return 0


def register(sub) -> dict:
    p = sub.add_parser("gsc-import")
    p.add_argument("file")
    return {"gsc-import": cmd_gsc_import}
