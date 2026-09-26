"""公開済み記事の改善対象を選ぶ。

Search Console の認証情報があれば実データ（順位・表示回数・CTR）で、なければ記事の古さで判断する。
環境変数:
  GSC_SERVICE_ACCOUNT_JSON  サービスアカウントの JSON キー（中身そのもの）
  GSC_SITE_URL              Search Console のプロパティ（例: https://example.com/ や sc-domain:example.com）
"""
from __future__ import annotations

import json
import logging
import os
from datetime import date, timedelta

from .articles import Article

log = logging.getLogger(__name__)

GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
MIN_DAYS_BETWEEN_UPDATES = 30


def fetch_gsc_pages(days: int = 28) -> dict[str, dict] | None:
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON")
    site = os.environ.get("GSC_SITE_URL")
    if not raw or not site:
        return None
    from urllib.parse import quote

    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account

    creds = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=[GSC_SCOPE])
    session = AuthorizedSession(creds)
    end = date.today() - timedelta(days=3)  # GSC のデータは数日遅れ
    body = {
        "startDate": (end - timedelta(days=days)).isoformat(),
        "endDate": end.isoformat(),
        "dimensions": ["page"],
        "rowLimit": 1000,
    }
    url = f"https://www.googleapis.com/webmasters/v3/sites/{quote(site, safe='')}/searchAnalytics/query"
    resp = session.post(url, json=body, timeout=60)
    resp.raise_for_status()
    rows = resp.json().get("rows", [])
    return {
        r["keys"][0]: {"clicks": r["clicks"], "impressions": r["impressions"], "ctr": r["ctr"], "position": r["position"]}
        for r in rows
    }


def _days_since(iso: str, today: date) -> int:
    try:
        return (today - date.fromisoformat(iso)).days
    except ValueError:
        return 10**6


def select_refresh_candidates(
    articles: list[Article],
    *,
    base_url: str,
    limit: int,
    refresh_after_days: int,
    gsc: dict[str, dict] | None,
    today: date | None = None,
) -> list[tuple[Article, str]]:
    today = today or date.today()
    fresh_enough = [a for a in articles if a.origin == "ai" and _days_since(a.updated, today) >= MIN_DAYS_BETWEEN_UPDATES]
    picks: list[tuple[tuple[int, float], Article, str]] = []  # (優先グループ, 値)

    if gsc:
        for a in fresh_enough:
            m = gsc.get(f"{base_url}/{a.url_path}")
            if not m:
                continue
            if m["impressions"] >= 100 and 4 <= m["position"] <= 20:
                reason = (f"検索順位 平均{m['position']:.1f}位・表示{int(m['impressions'])}回。"
                          f"1ページ目上位に上げるため、検索意図への回答と網羅性を強化する")
                picks.append(((1, m["impressions"]), a, reason))
            elif m["impressions"] >= 200 and m["ctr"] < 0.01:
                reason = (f"表示{int(m['impressions'])}回に対しクリック率{m['ctr'] * 100:.1f}%。"
                          f"タイトルとディスクリプションを検索者の関心に合わせて改善する")
                picks.append(((1, m["impressions"] * 0.8), a, reason))

    if len(picks) < limit:
        chosen = {a.slug for _, a, _ in picks}
        stale = [a for a in fresh_enough if a.slug not in chosen and _days_since(a.updated, today) >= refresh_after_days]
        for a in stale:
            picks.append(((0, _days_since(a.updated, today)), a, f"最終更新から{_days_since(a.updated, today)}日経過。料金・制度などの情報を最新化する"))

    picks.sort(key=lambda p: p[0], reverse=True)
    return [(a, reason) for _, a, reason in picks[:limit]]
