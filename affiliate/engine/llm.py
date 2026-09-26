"""Claude API 呼び出しと、月間予算の管理。

- 調査（research）: サーバー側 web_search ツールで最新の公開情報を集め、出典URLを返す
- 構造化生成（structured）: JSON Schema に沿った出力（記事本文・キーワード案・レビュー結果）を返す
どちらも拒否時は fallbacks="default" でサーバー側フォールバックし、使用量は data/usage.jsonl に記録する。
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import anthropic

from .config import USAGE_FILE

FALLBACK_BETA = "server-side-fallback-2026-07-01"
WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search", "max_uses": 8,
                   "user_location": {"type": "approximate", "country": "JP", "timezone": "Asia/Tokyo"}}
MAX_CONTINUATIONS = 5

# USD / 100万トークン（入力, 出力）。予算管理用の概算。
PRICES = {
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
}
WEB_SEARCH_USD = 10.0 / 1000


def api_key_from_env() -> str | None:
    """Secrets に貼り付けたキーの前後に改行・空白が混ざっていても動くようにする。
    （混ざったままだと HTTP ヘッダーが不正になり「Connection error.」になる）"""
    key = os.environ.get("ANTHROPIC_API_KEY")
    return key.strip() if key and key.strip() else None


_KEY_RE = re.compile(r"sk-ant-[A-Za-z0-9_\-]+")


def describe_error(e: BaseException) -> str:
    """ログ・Issue・コミットに残すエラー文。APIキーらしき文字列は必ず伏せる。"""
    text = f"{type(e).__name__}: {e}"
    if e.__cause__ is not None:
        text += f"（原因: {type(e.__cause__).__name__}）"
    return _KEY_RE.sub("sk-ant-***", text)


class BudgetExceeded(RuntimeError):
    pass


class RefusedError(RuntimeError):
    pass


def estimate_cost(model: str, usage) -> float:
    price_in, price_out = PRICES.get(model, PRICES["claude-opus-5"])
    tokens_in = (usage.input_tokens or 0) + (usage.cache_creation_input_tokens or 0) * 1.25
    tokens_in += (usage.cache_read_input_tokens or 0) * 0.1
    cost = tokens_in / 1e6 * price_in + (usage.output_tokens or 0) / 1e6 * price_out
    stu = getattr(usage, "server_tool_use", None)
    if stu is not None:
        cost += (stu.web_search_requests or 0) * WEB_SEARCH_USD
    return cost


def month_spend(usage_file: Path = USAGE_FILE, now: datetime | None = None) -> float:
    if not usage_file.exists():
        return 0.0
    month = (now or datetime.now(timezone.utc)).strftime("%Y-%m")
    total = 0.0
    for line in usage_file.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("ts", "").startswith(month):
            total += row.get("usd", 0.0)
    return total


class LLM:
    def __init__(self, model: str, monthly_budget_usd: float, usage_file: Path = USAGE_FILE):
        self.client = anthropic.Anthropic(api_key=api_key_from_env(), max_retries=4)
        self.model = model
        self.monthly_budget_usd = monthly_budget_usd
        self.usage_file = usage_file

    # ---- 予算 ---------------------------------------------------------------
    def check_budget(self) -> None:
        spent = month_spend(self.usage_file)
        if spent >= self.monthly_budget_usd:
            raise BudgetExceeded(f"今月のAPI費用が上限に達しました（${spent:.2f} / ${self.monthly_budget_usd:.2f}）")

    def _record(self, task: str, message) -> None:
        usd = estimate_cost(self.model, message.usage)
        row = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "task": task,
            "model": message.model,
            "input_tokens": message.usage.input_tokens,
            "output_tokens": message.usage.output_tokens,
            "usd": round(usd, 4),
        }
        self.usage_file.parent.mkdir(parents=True, exist_ok=True)
        with self.usage_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    # ---- 共通 ---------------------------------------------------------------
    def _stream(self, *, task: str, system: str, messages: list, effort: str, tools=None, fmt=None):
        self.check_budget()
        output_config: dict = {"effort": effort}
        if fmt is not None:
            output_config["format"] = fmt
        kwargs = dict(
            model=self.model,
            max_tokens=64000,
            system=system,
            messages=messages,
            thinking={"type": "adaptive"},
            output_config=output_config,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            cache_control={"type": "ephemeral"},
        )
        if tools:
            kwargs["tools"] = tools
        with self.client.beta.messages.stream(**kwargs) as stream:
            message = stream.get_final_message()
        self._record(task, message)
        if message.stop_reason == "refusal":
            category = getattr(message.stop_details, "category", None) if message.stop_details else None
            raise RefusedError(f"{task}: モデルが応答を拒否しました（category={category}）")
        return message

    @staticmethod
    def _text(message) -> str:
        return "".join(b.text for b in message.content if b.type == "text")

    # ---- 公開API -------------------------------------------------------------
    def research(self, *, task: str, system: str, prompt: str, effort: str = "medium") -> tuple[str, list[dict]]:
        """web_search で調べた結果の要約テキストと、実際に参照した出典の一覧を返す。"""
        messages: list = [{"role": "user", "content": prompt}]
        texts: list[str] = []
        sources: dict[str, str] = {}
        for _ in range(MAX_CONTINUATIONS + 1):
            message = self._stream(task=task, system=system, messages=messages, effort=effort,
                                   tools=[WEB_SEARCH_TOOL])
            for block in message.content:
                if block.type == "text":
                    texts.append(block.text)
                    for c in getattr(block, "citations", None) or []:
                        url = getattr(c, "url", None)
                        if url:
                            sources.setdefault(url, getattr(c, "title", None) or url)
                elif block.type == "web_search_tool_result" and isinstance(block.content, list):
                    for r in block.content:
                        if getattr(r, "url", None):
                            sources.setdefault(r.url, r.title or r.url)
            if message.stop_reason != "pause_turn":
                break
            # サーバー側ループが上限に達した: アシスタントの内容をそのまま返して再開させる
            messages = [messages[0], {"role": "assistant", "content": message.content}]
        return "".join(texts), [{"title": t, "url": u} for u, t in sources.items()]

    def structured(self, *, task: str, system: str, prompt: str, schema: dict, effort: str = "high") -> dict:
        message = self._stream(
            task=task,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            effort=effort,
            fmt={"type": "json_schema", "schema": schema},
        )
        if message.stop_reason == "max_tokens":
            raise RuntimeError(f"{task}: 出力が max_tokens で途切れました")
        return json.loads(self._text(message))
