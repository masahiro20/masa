"""給付金・補助金が使えるスクールの一覧（config/schools.yaml）を読み込み、確かめる。

一覧は「公式ページで確かめたこと」だけを載せるデータ。各スクールの制度ごとに、
確かめたページの URL（source）と確かめた日（checked）を必ず持たせ、ページにもそのまま表示する。
"""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

from .config import CONFIG_DIR, load_yaml

SCHOOLS_FILE = CONFIG_DIR / "schools.yaml"

# 制度の種類。key はデータとページの絞り込みで使う
SYSTEMS = {
    "ippan": {"name": "一般教育訓練給付金", "short": "一般教育訓練", "org": "厚生労働省"},
    "tokutei": {"name": "特定一般教育訓練給付金", "short": "特定一般教育訓練", "org": "厚生労働省"},
    "senmon": {"name": "専門実践教育訓練給付金", "short": "専門実践教育訓練", "org": "厚生労働省"},
    "reskilling": {"name": "リスキリングを通じたキャリアアップ支援事業", "short": "経産省リスキリング補助金", "org": "経済産業省"},
}
FIELDS = {
    "programming": "プログラミング",
    "ai": "AI・生成AI",
    "webdesign": "Webデザイン",
    "marketing": "Webマーケティング",
    "data": "データ分析",
}
FORMATS = {"online": "オンライン", "school": "通学", "abroad": "海外留学"}
# 確かめてからこの日数を過ぎた情報は、ページで「再確認中」と出す（制度や対象講座は年度で変わるため）
STALE_DAYS = 120


def load_schools(path: Path = SCHOOLS_FILE) -> list[dict]:
    if not path.exists():
        return []
    return (load_yaml(path) or {}).get("schools") or []


def validate(schools: list[dict], programs: dict[str, dict]) -> list[str]:
    """一覧のデータの抜けを返す。空なら問題なし。"""
    issues: list[str] = []
    ids = set()
    for s in schools:
        sid = s.get("id") or "?"
        if sid in ids:
            issues.append(f"{sid}: id が重複しています")
        ids.add(sid)
        if not s.get("name"):
            issues.append(f"{sid}: name がありません")
        if not str(s.get("official") or "").startswith("https://"):
            issues.append(f"{sid}: official（公式サイトのURL）は https:// で始めてください")
        for f in s.get("fields") or []:
            if f not in FIELDS:
                issues.append(f"{sid}: 分野 {f} は {sorted(FIELDS)} のどれかにしてください")
        for f in s.get("format") or []:
            if f not in FORMATS:
                issues.append(f"{sid}: 受講形式 {f} は {sorted(FORMATS)} のどれかにしてください")
        pid = s.get("program")
        if pid and pid not in programs:
            issues.append(f"{sid}: program {pid} が programs.yaml にありません")
        if pid and programs.get(pid, {}).get("hold"):
            issues.append(f"{sid}: program {pid} は保管のみ（hold）の案件です")
        subs = s.get("subsidies") or []
        if not subs:
            issues.append(f"{sid}: subsidies（使える制度）が1つもありません")
        for sub in subs:
            if sub.get("system") not in SYSTEMS:
                issues.append(f"{sid}: system {sub.get('system')} は {sorted(SYSTEMS)} のどれかにしてください")
            if not str(sub.get("source") or "").startswith("https://"):
                issues.append(f"{sid}: 制度の source（確かめた公式ページ）は https:// で始めてください")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(sub.get("checked") or "")):
                issues.append(f"{sid}: 制度の checked（確かめた日）は YYYY-MM-DD で書いてください")
    return issues


def _live(program: dict | None) -> bool:
    return bool(program) and bool((program.get("url") or "").strip()) and not program.get("hold")


def enrich(schools: list[dict], programs: dict[str, dict], today: date | None = None) -> list[dict]:
    """テンプレートで使う形にする。広告が入っている案件は ad に広告の情報を入れる。"""
    today = today or date.today()
    out = []
    for s in schools:
        program = programs.get(s.get("program") or "")
        subs = []
        for sub in s.get("subsidies") or []:
            checked = date.fromisoformat(str(sub["checked"]))
            subs.append({**sub, "info": SYSTEMS[sub["system"]], "stale": (today - checked).days > STALE_DAYS})
        ad = None
        if _live(program):
            ad = {"url": program["url"], "pixel": program.get("pixel") or "", "cta": s.get("cta") or program.get("cta") or "公式サイトで詳しく見る"}
        out.append({
            **s,
            "subsidies": subs,
            "systems": sorted({x["system"] for x in subs}),
            "field_names": [FIELDS[f] for f in s.get("fields") or []],
            "format_names": [FORMATS[f] for f in s.get("format") or []],
            "ad": ad,
            "checked_last": max((str(x["checked"]) for x in subs), default=""),
        })
    # 広告のあるスクールを先に出すのではなく、制度の数と名前の順で並べる（中立な一覧にする）
    out.sort(key=lambda x: (-len(x["systems"]), x["name"]))
    return out
