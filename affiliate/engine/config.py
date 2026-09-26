"""設定ファイルとディレクトリの読み込み。"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"
CONTENT_DIR = ROOT / "content"
ARTICLES_DIR = CONTENT_DIR / "articles"
PAGES_DIR = CONTENT_DIR / "pages"
TEMPLATES_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"
PUBLIC_DIR = ROOT / "public"
KEYWORDS_FILE = DATA_DIR / "keywords.yaml"
USAGE_FILE = DATA_DIR / "usage.jsonl"
RUN_LOG_FILE = DATA_DIR / "run_log.jsonl"


def load_yaml(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def dump_yaml(path: Path, data: Any, header: str = "") -> None:
    text = yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=1000)
    path.write_text(header + text, encoding="utf-8")


@dataclass
class Config:
    site: dict
    niche: dict
    autopilot: dict
    quality: dict
    programs: list[dict]

    @property
    def programs_by_id(self) -> dict[str, dict]:
        return {p["id"]: p for p in self.programs}

    @property
    def category_names(self) -> dict[str, str]:
        return {c["slug"]: c["name"] for c in self.niche["categories"]}


def load_config(config_dir: Path = CONFIG_DIR) -> Config:
    site = load_yaml(config_dir / "site.yaml")
    programs = load_yaml(config_dir / "programs.yaml")["programs"]
    return Config(
        site=site["site"],
        niche=site["niche"],
        autopilot=site["autopilot"],
        quality=site["quality"],
        programs=programs,
    )
