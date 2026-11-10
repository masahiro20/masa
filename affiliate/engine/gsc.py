"""Search Console の「検索パフォーマンス」をエクスポートしたファイルを取り込み、伸ばしどころの記事を選ぶ。

  python -m engine gsc-import FILE      エクスポートの ZIP（または中の「ページ.csv」「クエリ.csv」）を取り込む

  python -m engine gsc-fetch            Search Console API から同じデータを取る（毎週 GitHub Actions が実行）

Search Console → 検索パフォーマンス → 右上の「エクスポート」→「CSV をダウンロード」で得た ZIP をそのまま渡せる。
取り込んだ数字は data/gsc_pages.json / data/gsc_queries.json に保存され、`rewrite-next` が
「あと少しで1ページ目上位」「表示は多いのにクリックされない」記事を優先して書き直し対象にする。
gsc-fetch は環境変数 GSC_SERVICE_ACCOUNT_JSON（サービスアカウントのJSONキー）と GSC_SITE_URL が必要。
"""
from __future__ import annotations

import csv
import re
import io
import json
import os
import zipfile
from datetime import date, timedelta
from pathlib import Path

from .articles import Article
from .config import DATA_DIR

PAGES_FILE = DATA_DIR / "gsc_pages.json"
QUERIES_FILE = DATA_DIR / "gsc_queries.json"
DAILY_FILE = DATA_DIR / "gsc_daily.json"
GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
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
    kind = ("pages" if ("ページ" in first or "page" in first) else "queries" if ("クエリ" in first or "quer" in first)
            else "daily" if ("日付" in first or first == "date") else "")
    idx = {}
    for key, names in _COLS.items():
        idx[key] = next((i for i, h in enumerate(header) if any(n in h for n in names)), None)
    # 表示回数だけのエクスポート（クリック数・CTR・掲載順位の列を外して出したもの）も受け付ける。
    # ない列は None にして、順位やCTRを使う判定には使わない
    if not kind or idx["impressions"] is None:
        return "", {}
    out = {}
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue
        out[r[0].strip()] = {k: (_num(r[i]) if i < len(r) else 0.0) if i is not None else None
                             for k, i in idx.items()}
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
        target = {"pages": PAGES_FILE, "queries": QUERIES_FILE, "daily": DAILY_FILE}[kind]
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
        imp, pos, ctr = m["impressions"], m.get("position"), m.get("ctr")
        if pos is None or ctr is None:
            continue
        if imp >= 50 and pos <= 10 and ctr < 0.025:
            found.append({"slug": a.slug, "kind": "ctr", "impressions": imp, "position": round(pos, 1),
                          "reason": f"平均{pos:.1f}位・表示{int(imp)}回なのにクリック率{ctr * 100:.1f}%。"
                                    "タイトルと description を、検索した人が『自分の答えがある』と思える言葉に直す"})
        elif imp >= 20 and 4 <= pos <= 20:
            found.append({"slug": a.slug, "kind": "rank", "impressions": imp, "position": round(pos, 1),
                          "reason": f"平均{pos:.1f}位・表示{int(imp)}回。あと少しで1ページ目上位。"
                                    "検索意図への答えを冒頭で示し、足りない論点・比較表・よくある質問を補う"})
    found.sort(key=lambda x: x["impressions"], reverse=True)
    return found


def load_queries() -> dict[str, dict]:
    if not QUERIES_FILE.exists():
        return {}
    return json.loads(QUERIES_FILE.read_text(encoding="utf-8")).get("rows", {})


QUESTION_RE = re.compile(r"[？?]$|ありますか|ですか|ますか|には$|とは$|どこで|いつ|どうすれば")


def ideas(queries: dict[str, dict], articles: list[Article], n: int = 15) -> dict[str, list[dict]]:
    """Search Console に出ている検索語から、次に書く・補うべきものを選ぶ。

    - questions: 文章で打ち込まれた質問。記事の見出しや「よくある質問」にそのまま使うと拾われやすい
    - near_miss: 表示はあるのに 8〜40 位にとどまる語。専用の記事を書くか、近い記事に節を足す候補
    サイト名での検索や、既存記事のキーワードとほぼ同じ語は除く。
    """
    covered = {re.sub(r"\s+", "", (a.keyword or "").lower()) for a in articles}
    brand = ("スキルコンパス", "skill compass", "skillcompass")
    questions, near = [], []
    for q, m in queries.items():
        key = re.sub(r"\s+", "", q.lower())
        if any(b in q.lower() for b in brand) or key in covered or q.startswith("intitle:"):
            continue
        row = {"query": q, "impressions": int(m.get("impressions") or 0),
               "position": round(m.get("position") or 0, 1)}
        if QUESTION_RE.search(q):
            questions.append(row)
        elif row["impressions"] >= 3 and 8 <= row["position"] <= 40:
            near.append(row)
    questions.sort(key=lambda r: -r["impressions"])
    near.sort(key=lambda r: (-r["impressions"], r["position"]))
    return {"questions": questions[:n], "near_miss": near[:n]}


def cmd_ideas(cfg, args) -> int:
    from .articles import load_articles
    print(json.dumps(ideas(load_queries(), load_articles(), args.n), ensure_ascii=False, indent=1))
    return 0


def fetch(session, site: str, dimension: str, start: date, end: date) -> dict[str, dict]:
    """Search Console API の検索パフォーマンス（ウェブ検索）を、1つの軸で取り出す。"""
    from urllib.parse import quote

    url = f"https://www.googleapis.com/webmasters/v3/sites/{quote(site, safe='')}/searchAnalytics/query"
    body = {"startDate": start.isoformat(), "endDate": end.isoformat(), "dimensions": [dimension],
            "type": "web", "rowLimit": 1000}
    resp = session.post(url, json=body, timeout=60)
    resp.raise_for_status()
    return {r["keys"][0]: {"clicks": r["clicks"], "impressions": r["impressions"], "ctr": r["ctr"],
                           "position": r["position"]}
            for r in resp.json().get("rows", [])}


def cmd_gsc_fetch(cfg, args) -> int:
    raw, site = os.environ.get("GSC_SERVICE_ACCOUNT_JSON"), os.environ.get("GSC_SITE_URL")
    if not raw or not site:
        print("Search Console の認証情報が登録されていないため、取得しません")
        return 0
    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account

    creds = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=[GSC_SCOPE])
    session = AuthorizedSession(creds)
    end = date.today() - timedelta(days=2)  # Search Console のデータは2〜3日遅れて確定する
    start = end - timedelta(days=args.days - 1)
    today = date.today().isoformat()
    period = {"start": start.isoformat(), "end": end.isoformat()}
    for dimension, path in (("page", PAGES_FILE), ("query", QUERIES_FILE), ("date", DAILY_FILE)):
        rows = fetch(session, site, dimension, start, end)
        path.write_text(json.dumps({"imported": today, "period": period, "rows": rows}, ensure_ascii=False,
                                   indent=1, sort_keys=True), encoding="utf-8")
        print(f"{dimension}: {len(rows)}行")
    return 0


def weekly_trend(daily: dict[str, dict]) -> list[dict]:
    """日別の数字を、直近から7日ずつまとめる（新しい順）。"""
    days = sorted(daily)
    weeks = []
    while days:
        chunk, days = days[-7:], days[:-7]
        if len(chunk) < 7:
            break
        imp = sum(daily[d]["impressions"] for d in chunk)
        clicks = sum(daily[d]["clicks"] for d in chunk)
        pos = sum((daily[d]["position"] or 0) * daily[d]["impressions"] for d in chunk) / imp if imp else 0
        weeks.append({"start": chunk[0], "end": chunk[-1], "impressions": int(imp), "clicks": int(clicks),
                      "ctr": clicks / imp if imp else 0, "position": round(pos, 1)})
    return weeks


def load_daily() -> dict[str, dict]:
    if not DAILY_FILE.exists():
        return {}
    return json.loads(DAILY_FILE.read_text(encoding="utf-8")).get("rows", {})


def cmd_gsc_import(cfg, args) -> int:
    path = Path(args.file)
    if not path.exists():
        print(f"ファイルがありません: {path}")
        return 1
    counts = import_export(path)
    if not counts:
        print("Search Console のエクスポート（ページ / クエリの CSV）として読めませんでした")
        return 1
    names = {"pages": "ページ", "queries": "クエリ", "daily": "日付"}
    print("取り込みました: " + "、".join(f"{names[k]} {n}行" for k, n in counts.items()))
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
    p = sub.add_parser("ideas")
    p.add_argument("--n", type=int, default=15)
    p = sub.add_parser("gsc-fetch")
    p.add_argument("--days", type=int, default=90)
    return {"gsc-import": cmd_gsc_import, "ideas": cmd_ideas, "gsc-fetch": cmd_gsc_fetch}
