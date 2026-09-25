"""IndexNow で Bing などの検索エンジンに新規・更新URLを即時通知する（Google は sitemap 経由で巡回）。"""
from __future__ import annotations

import logging
from urllib.parse import urlparse

import requests

from .site import indexnow_key

log = logging.getLogger(__name__)
ENDPOINT = "https://api.indexnow.org/indexnow"


def ping(base_url: str, urls: list[str]) -> bool:
    if not urls:
        return True
    base_url = base_url.rstrip("/")
    key = indexnow_key(base_url)
    payload = {
        "host": urlparse(base_url).netloc,
        "key": key,
        "keyLocation": f"{base_url}/{key}.txt",
        "urlList": urls[:10000],
    }
    try:
        resp = requests.post(ENDPOINT, json=payload, timeout=30)
    except requests.RequestException as e:
        log.warning("IndexNow 通知に失敗しました: %s", e)
        return False
    ok = resp.status_code in (200, 202)
    log.info("IndexNow: %s件 → HTTP %s", len(urls), resp.status_code)
    return ok
