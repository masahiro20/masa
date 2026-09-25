"""キーワード → 調査 → 執筆 → 品質ゲート → 自動修正 → 編集長レビュー → 保存 のパイプライン。"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date

from . import prompts
from .articles import Article, load_articles, unique_slug
from .config import Config
from .llm import LLM
from .quality import check_article

log = logging.getLogger(__name__)


@dataclass
class WriteResult:
    article: Article | None
    issues: list[str]


def _filter_sources(urls: list[str], allowed: list[dict]) -> list[dict]:
    """モデルが挙げた出典のうち、実際の検索結果に存在したURLだけを残す（架空URL対策）。"""
    by_url = {s["url"]: s for s in allowed}
    picked, seen = [], set()
    for url in urls:
        if url in by_url and url not in seen:
            picked.append({"title": by_url[url]["title"], "url": url})
            seen.add(url)
    return picked


def _to_article(data: dict, *, keyword: str, sources: list[dict], slug: str, published: str,
                updated: str) -> Article:
    return Article(
        title=data["title"].strip(),
        slug=slug,
        description=data["description"].strip(),
        category=data["category"].strip(),
        body=data["body_markdown"].strip(),
        tags=[t.strip() for t in data.get("tags", []) if t.strip()][:6],
        keyword=keyword,
        programs=data.get("programs", []),
        sources=_filter_sources(data.get("source_urls", []), sources),
        published=published,
        updated=updated,
        origin="ai",
    )


def _article_json(article: Article) -> dict:
    return {
        "title": article.title,
        "slug": article.slug,
        "description": article.description,
        "category": article.category,
        "tags": article.tags,
        "programs": article.programs,
        "source_urls": [s["url"] for s in article.sources],
        "body_markdown": article.body,
    }


class Writer:
    def __init__(self, cfg: Config, llm: LLM):
        self.cfg = cfg
        self.llm = llm
        self.system = prompts.editorial_system(cfg)

    def _gate(self, article: Article, existing: list[Article]) -> list[str]:
        return check_article(
            article,
            quality=self.cfg.quality,
            programs=self.cfg.programs_by_id,
            categories=set(self.cfg.category_names),
            existing=existing,
        ).issues

    def _review(self, article: Article, research: str) -> tuple[int, list[str]]:
        result = self.llm.structured(
            task="review",
            system=self.system,
            prompt=prompts.review_prompt(_article_json(article), research),
            schema=prompts.REVIEW_SCHEMA,
            effort="medium",
        )
        return int(result["score"]), list(result["problems"])

    def _polish(self, article: Article, research: str, sources: list[dict], existing: list[Article],
                build) -> WriteResult:
        """品質ゲートと編集長レビューに通るまで自動修正する（回数は設定で制限）。"""
        attempts = self.cfg.autopilot["max_repair_attempts"]
        min_score = self.cfg.autopilot["min_editor_score"]
        for attempt in range(attempts + 1):
            issues = self._gate(article, existing)
            if not issues:
                score, problems = self._review(article, research)
                article.editor_score = score
                if score >= min_score:
                    return WriteResult(article, [])
                issues = [f"編集長レビュー {score}点（合格 {min_score}点以上）"] + problems
            log.info("不合格（%d回目）: %s", attempt + 1, issues)
            if attempt == attempts:
                return WriteResult(None, issues)
            data = self.llm.structured(
                task="repair",
                system=self.system,
                prompt=prompts.repair_prompt(_article_json(article), issues),
                schema=prompts.ARTICLE_SCHEMA,
            )
            article = build(data)
        return WriteResult(None, ["unreachable"])

    def write(self, item: dict) -> WriteResult:
        keyword = item["keyword"]
        today = date.today().isoformat()
        existing = load_articles()
        research, sources = self.llm.research(
            task="research", system=prompts.RESEARCH_SYSTEM, prompt=prompts.research_prompt(keyword, self.cfg)
        )
        data = self.llm.structured(
            task="write",
            system=self.system,
            prompt=prompts.write_prompt(keyword, item, research, sources, today),
            schema=prompts.ARTICLE_SCHEMA,
        )
        slug = unique_slug(data["slug"], {a.slug for a in existing})

        def build(d: dict) -> Article:
            return _to_article(d, keyword=keyword, sources=sources, slug=slug, published=today, updated=today)

        return self._polish(build(data), research, sources, existing, build)

    def refresh(self, article: Article, reason: str) -> WriteResult:
        today = date.today().isoformat()
        existing = load_articles()
        research, sources = self.llm.research(
            task="refresh-research",
            system=prompts.RESEARCH_SYSTEM,
            prompt=prompts.research_prompt(article.keyword or article.title, self.cfg),
        )
        sources = sources + [s for s in article.sources if s["url"] not in {x["url"] for x in sources}]
        data = self.llm.structured(
            task="refresh",
            system=self.system,
            prompt=prompts.refresh_prompt(_article_json(article), research, sources, reason, today),
            schema=prompts.ARTICLE_SCHEMA,
        )

        def build(d: dict) -> Article:
            return _to_article(d, keyword=article.keyword, sources=sources, slug=article.slug,
                               published=article.published, updated=today)

        return self._polish(build(data), research, sources, existing, build)
