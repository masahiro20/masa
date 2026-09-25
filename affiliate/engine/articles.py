"""記事ファイル（YAML front matter 付き Markdown）の読み書き。"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

from .config import ARTICLES_DIR

FRONT_MATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.S)
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


@dataclass
class Article:
    title: str
    slug: str
    description: str
    category: str
    body: str
    tags: list[str] = field(default_factory=list)
    keyword: str = ""
    programs: list[str] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)
    published: str = ""
    updated: str = ""
    origin: str = "ai"
    editor_score: int | None = None

    @property
    def path(self) -> Path:
        return ARTICLES_DIR / f"{self.slug}.md"

    @property
    def url_path(self) -> str:
        return f"articles/{self.slug}/"

    def front_matter(self) -> dict:
        data = {
            "title": self.title,
            "slug": self.slug,
            "description": self.description,
            "category": self.category,
            "tags": self.tags,
            "keyword": self.keyword,
            "programs": self.programs,
            "published": self.published,
            "updated": self.updated or self.published,
            "origin": self.origin,
            "editor_score": self.editor_score,
            "sources": self.sources,
        }
        return data

    def to_text(self) -> str:
        fm = yaml.safe_dump(self.front_matter(), allow_unicode=True, sort_keys=False, width=1000)
        return f"---\n{fm}---\n{self.body.strip()}\n"

    def save(self, directory: Path = ARTICLES_DIR) -> Path:
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{self.slug}.md"
        path.write_text(self.to_text(), encoding="utf-8")
        return path


def parse_article(text: str) -> Article:
    m = FRONT_MATTER_RE.match(text)
    if not m:
        raise ValueError("front matter がありません")
    fm = yaml.safe_load(m.group(1)) or {}
    for key in ("published", "updated"):
        if isinstance(fm.get(key), date):
            fm[key] = fm[key].isoformat()
    return Article(
        title=fm["title"],
        slug=fm["slug"],
        description=fm.get("description", ""),
        category=fm.get("category", ""),
        body=m.group(2).strip(),
        tags=fm.get("tags") or [],
        keyword=fm.get("keyword", ""),
        programs=fm.get("programs") or [],
        sources=fm.get("sources") or [],
        published=fm.get("published", ""),
        updated=fm.get("updated", "") or fm.get("published", ""),
        origin=fm.get("origin", "ai"),
        editor_score=fm.get("editor_score"),
    )


def load_articles(directory: Path = ARTICLES_DIR) -> list[Article]:
    if not directory.exists():
        return []
    articles = [parse_article(p.read_text(encoding="utf-8")) for p in sorted(directory.glob("*.md"))]
    articles.sort(key=lambda a: (a.published, a.slug), reverse=True)
    return articles


def unique_slug(slug: str, existing: set[str]) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", slug.lower()).strip("-") or "article"
    candidate, n = slug, 2
    while candidate in existing:
        candidate = f"{slug}-{n}"
        n += 1
    return candidate
