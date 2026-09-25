"""記事テーマ（キーワード）の在庫管理と自動補充。

優先度 = 案件の報酬目安 × 検索意図の重み。申込に近い意図・報酬の高い案件ほど先に記事化する。
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from . import prompts
from .config import KEYWORDS_FILE, Config, dump_yaml, load_yaml
from .llm import LLM

log = logging.getLogger(__name__)

INTENT_WEIGHT = {"transactional": 1.0, "commercial": 0.8, "informational": 0.4}
HEADER = (
    "# 記事テーマの在庫（キュー）。planner が自動で補充・並べ替えし、writer が上から順に記事化します。\n"
    "# status: queued（未着手） / published（公開済み） / rejected（品質基準を満たせず見送り）\n"
    "# intent: transactional（申込直前） / commercial（比較検討） / informational（情報収集）\n"
)


def normalize(keyword: str) -> str:
    return " ".join(sorted(re.sub(r"[\s　]+", " ", keyword.lower()).strip().split(" ")))


def score(item: dict, programs: dict[str, dict]) -> float:
    reward = programs.get(item.get("program", ""), {}).get("est_reward_jpy", 0)
    return round(reward * INTENT_WEIGHT.get(item.get("intent", ""), 0.4), 1)


class KeywordQueue:
    def __init__(self, path: Path = KEYWORDS_FILE):
        self.path = path
        self.items: list[dict] = (load_yaml(path) or {}).get("keywords", []) if path.exists() else []

    def save(self) -> None:
        dump_yaml(self.path, {"keywords": self.items}, header=HEADER)

    @property
    def queued(self) -> list[dict]:
        return [i for i in self.items if i.get("status") == "queued"]

    def rescore(self, programs: dict[str, dict]) -> None:
        for item in self.items:
            item["score"] = score(item, programs)
        order = {"queued": 0, "published": 1, "rejected": 2}
        self.items.sort(key=lambda i: (order.get(i.get("status"), 3), -i.get("score", 0)))

    def next(self) -> dict | None:
        queued = self.queued
        return queued[0] if queued else None

    def add(self, candidates: list[dict], cfg: Config) -> int:
        known = {normalize(i["keyword"]) for i in self.items}
        added = 0
        for c in candidates:
            key = normalize(c["keyword"])
            if key in known or c.get("program") not in cfg.programs_by_id:
                continue
            if c.get("category") not in cfg.category_names:
                c["category"] = cfg.programs_by_id[c["program"]]["category"]
            self.items.append({
                "keyword": c["keyword"].strip(),
                "intent": c["intent"],
                "category": c["category"],
                "program": c["program"],
                "score": 0,
                "status": "queued",
            })
            known.add(key)
            added += 1
        return added


def replenish(queue: KeywordQueue, cfg: Config, llm: LLM, n: int = 20) -> int:
    """在庫が少なくなったら、最新動向を調べたうえで新しいキーワードを追加する。"""
    trend_notes, _ = llm.research(
        task="plan-research",
        system=prompts.RESEARCH_SYSTEM,
        prompt=(
            f"「{cfg.niche['theme']}」の分野で、ここ3か月の日本国内の動向（制度変更、新サービス、料金改定、"
            f"話題になっている悩み・検索されている疑問）を調べ、記事テーマのヒントになる事実を箇条書きでまとめてください。"
        ),
        effort="low",
    )
    result = llm.structured(
        task="plan",
        system=prompts.editorial_system(cfg),
        prompt=prompts.plan_prompt(cfg, [i["keyword"] for i in queue.items], trend_notes, n),
        schema=prompts.PLAN_SCHEMA,
        effort="medium",
    )
    added = queue.add(result["keywords"], cfg)
    log.info("キーワードを %d 件追加しました", added)
    return added
