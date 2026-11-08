"""新しく公開した記事を X（旧Twitter）に自動で投稿する。

  python -m engine post-x --slugs SLUG ... [--dry-run]

GitHub の Secrets に次の4つを登録すると動く（登録がなければ何もせず終了する。費用もかからない）。
  X_API_KEY / X_API_SECRET            アプリの API Key と API Key Secret
  X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET  アプリに「読み書き」権限を付けてから発行した Access Token と Secret

X API は使った分だけの支払いで、リンク付きの投稿は1件ごとに課金される。
1回の実行で投稿する数は site.yaml の social.x_max_per_run で抑え、月の上限は X の Developer Console の利用上限で決める。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import time
from urllib.parse import quote

import requests

from .articles import Article, load_articles

log = logging.getLogger(__name__)
ENDPOINT = "https://api.x.com/2/tweets"
URL_WEIGHT = 23  # X はURLを長さに関係なく23字として数える
MAX_WEIGHT = 280
ENV_KEYS = ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET")


def _weight(text: str) -> int:
    """X の文字数の数え方（日本語などは1字を2と数える）。"""
    total = 0
    for ch in text:
        cp = ord(ch)
        light = cp <= 4351 or 8192 <= cp <= 8205 or 8208 <= cp <= 8223 or 8242 <= cp <= 8247
        total += 1 if light else 2
    return total


def _cut(text: str, budget: int) -> str:
    if _weight(text) <= budget:
        return text
    out = ""
    for ch in text:
        if _weight(out + ch + "…") > budget:
            break
        out += ch
    return out.rstrip("、。 ") + "…"


def compose(article: Article, url: str, hashtag: str = "") -> str:
    """誰向けか → タイトル → 答えの一文 → URL の順に並べる。長すぎるときは答えの一文から縮める。"""
    answer = article.description
    if article.audience and answer.startswith(article.audience):
        answer = answer[len(article.audience):].lstrip("。")
    answer = answer.split("。")[0] + "。" if "。" in answer else answer
    head = f"{article.audience}\n\n{article.title}" if article.audience else article.title
    tail = f"\n\n{url}" + (f"\n{hashtag}" if hashtag else "")
    fixed = _weight(head) + _weight(tail) - _weight(url) + URL_WEIGHT + _weight("\n\n")
    room = MAX_WEIGHT - fixed
    if room < 20:
        head = _cut(article.title, MAX_WEIGHT - (_weight(tail) - _weight(url) + URL_WEIGHT))
        return head + tail
    return f"{head}\n\n{_cut(answer, room)}{tail}"


def oauth1_header(method: str, url: str, keys: dict[str, str], params: dict[str, str] | None = None,
                  nonce: str | None = None, timestamp: str | None = None) -> str:
    """OAuth 1.0a の Authorization ヘッダー（HMAC-SHA1）。JSON の本文は署名に含めない。"""
    oauth = {
        "oauth_consumer_key": keys["X_API_KEY"],
        "oauth_nonce": nonce or secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": timestamp or str(int(time.time())),
        "oauth_token": keys["X_ACCESS_TOKEN"],
        "oauth_version": "1.0",
    }

    def enc(s: str) -> str:
        return quote(str(s), safe="~")

    pairs = sorted((enc(k), enc(v)) for k, v in {**(params or {}), **oauth}.items())
    base = "&".join([method.upper(), enc(url), enc("&".join(f"{k}={v}" for k, v in pairs))])
    signing_key = f"{enc(keys['X_API_SECRET'])}&{enc(keys['X_ACCESS_TOKEN_SECRET'])}"
    digest = hmac.new(signing_key.encode(), base.encode(), hashlib.sha1).digest()
    oauth["oauth_signature"] = base64.b64encode(digest).decode()
    return "OAuth " + ", ".join(f'{enc(k)}="{enc(v)}"' for k, v in sorted(oauth.items()))


def post(text: str, keys: dict[str, str]) -> bool:
    try:
        resp = requests.post(ENDPOINT, json={"text": text}, timeout=30,
                             headers={"Authorization": oauth1_header("POST", ENDPOINT, keys)})
    except requests.RequestException as e:
        log.warning("X への投稿に失敗しました: %s", e)
        return False
    if resp.status_code != 201:
        # 本文には利用者の情報が含まれないので、原因の確認のためにそのまま残す
        log.warning("X への投稿に失敗しました: HTTP %s %s", resp.status_code, resp.text[:300])
        return False
    return True


def cmd_post_x(cfg, args) -> int:
    keys = {k: os.environ.get(k, "") for k in ENV_KEYS}
    if not args.dry_run and not all(keys.values()):
        print("X のキーが登録されていないため、投稿しません")
        return 0
    social = cfg.site.get("social", {})
    limit = int(social.get("x_max_per_run", 3))
    by_slug = {a.slug: a for a in load_articles()}
    base = cfg.site["base_url"].rstrip("/")
    targets = [by_slug[s] for s in args.slugs if s in by_slug][:limit]
    posted = 0
    for a in targets:
        text = compose(a, f"{base}/{a.url_path}", social.get("hashtags", {}).get(a.category, ""))
        if args.dry_run:
            print(f"--- {a.slug}（{_weight(text)}/{MAX_WEIGHT}）\n{text}\n")
            continue
        if post(text, keys):
            posted += 1
            print(f"投稿しました: {a.slug}")
    if not args.dry_run:
        print(f"X に {posted}/{len(targets)} 件投稿しました")
    return 0


def register(sub) -> dict:
    p = sub.add_parser("post-x")
    p.add_argument("--slugs", nargs="*", default=[])
    p.add_argument("--dry-run", action="store_true", help="投稿せずに文面だけ表示する")
    return {"post-x": cmd_post_x}
