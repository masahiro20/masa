"""ASP の管理画面からコピーした広告コードを programs.yaml に反映する。

  python -m engine set-ad 案件ID 広告コード.txt [--asp a8|moshimo|...] [--name サービス名] [--cta ボタン文言]

広告コードは A8.net・もしもアフィリエイトなどの「テキストリンク」をそのまま貼ったもの
（URL だけでも可）。リンク先URLと、表示回数を数える 1×1 の計測用画像を取り出し、
programs.yaml の該当案件の url / pixel / asp を書き換える（コメントや並びは保つ）。
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

from .config import CONFIG_DIR

HREF_RE = re.compile(r"""<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']""", re.I)
IMG_RE = re.compile(r"<img\b[^>]*>", re.I)
SRC_RE = re.compile(r"""\bsrc\s*=\s*["']([^"']+)["']""", re.I)
URL_RE = re.compile(r"(?:https?:)?//\S+")


def _normalize(url: str) -> str:
    url = html.unescape(url.strip())
    return "https:" + url if url.startswith("//") else url


def _is_pixel(tag: str, src: str) -> bool:
    one_by_one = re.search(r"""\bwidth\s*=\s*["']?1\b""", tag) and re.search(r"""\bheight\s*=\s*["']?1\b""", tag)
    return bool(one_by_one) or "0.gif?a8mat=" in src or "/impression" in src


def parse_ad_code(code: str) -> tuple[str, str]:
    """広告コードから (リンク先URL, 計測用画像URL) を取り出す。見つからなければ空文字。"""
    code = code.strip()
    m = HREF_RE.search(code)
    if m:
        url = _normalize(m.group(1))
    else:
        bare = URL_RE.search(code)
        url = _normalize(bare.group(0)) if bare else ""
    pixel = ""
    for tag in IMG_RE.findall(code):
        src = SRC_RE.search(tag)
        if src and _is_pixel(tag, src.group(1)):
            pixel = _normalize(src.group(1))
            break
    return url, pixel


def parse_banner(code: str) -> dict:
    """リンクの中にあるバナー画像（計測用の 1×1 画像以外）を {src, width, height} で返す。なければ空。"""
    m = re.search(r"<a\b[^>]*>(.*?)</a>", code, re.I | re.S)
    if not m:
        return {}
    for tag in IMG_RE.findall(m.group(1)):
        src = SRC_RE.search(tag)
        if not src or _is_pixel(tag, src.group(1)):
            continue
        size = {k: int(v) for k, v in re.findall(r"""\b(width|height)\s*=\s*["']?(\d+)""", tag)}
        return {"src": _normalize(src.group(1)), "width": size.get("width", 0), "height": size.get("height", 0)}
    return {}


def guess_asp(url: str) -> str:
    for marker, name in (("a8.net", "a8"), ("moshimo.com", "moshimo"), ("afi-b.com", "afb"),
                         ("valuecommerce", "valuecommerce"), ("accesstrade", "accesstrade")):
        if marker in url:
            return name
    return ""


def update_program(text: str, pid: str, fields: dict[str, str]) -> str:
    """programs.yaml のテキストのうち、案件 pid のブロックだけを書き換える。"""
    lines = text.splitlines(keepends=True)
    start = next((i for i, line in enumerate(lines) if re.match(rf"\s*-\s+id:\s*{re.escape(pid)}\s*$", line)), None)
    if start is None:
        raise KeyError(pid)
    end = next((i for i in range(start + 1, len(lines)) if re.match(r"\s*-\s+id:", lines[i])), len(lines))
    indent = re.match(r"(\s*)-", lines[start]).group(1) + "  "
    block = lines[start:end]
    for key, value in fields.items():
        new = f"{indent}{key}: {json.dumps(value, ensure_ascii=False)}\n"
        idx = next((i for i, line in enumerate(block) if re.match(rf"{indent}{key}:", line)), None)
        if idx is not None:
            block[idx] = new
        else:
            anchor = next((i for i, line in enumerate(block) if re.match(rf"{indent}url:", line)), len(block) - 1)
            block.insert(anchor + 1, new)
    return "".join(lines[:start] + block + lines[end:])


def cmd_set_ad(cfg, args) -> int:
    source = Path(args.code)
    code = source.read_text(encoding="utf-8") if source.exists() else args.code
    url, pixel = parse_ad_code(code)
    if not url:
        print("広告コードからリンク先URLを見つけられませんでした")
        return 1
    if args.id not in cfg.programs_by_id:
        print(f"programs.yaml にない案件IDです: {args.id}（候補: {', '.join(cfg.programs_by_id)}）")
        return 1
    path = CONFIG_DIR / "programs.yaml"
    banner = parse_banner(code)
    fields = {"asp": args.asp or guess_asp(url), "url": url, "pixel": pixel,
              # バナー広告はコードどおり画像で表示する（テキストリンクに作り替えない）
              "banner": banner.get("src", ""), "banner_width": banner.get("width", 0),
              "banner_height": banner.get("height", 0)}
    if args.name:
        fields["name"] = args.name
    if args.cta:
        fields["cta"] = args.cta
    path.write_text(update_program(path.read_text(encoding="utf-8"), args.id, fields), encoding="utf-8")
    kind = "バナー" if banner else "テキスト"
    print(f"{args.id} に広告リンクを設定しました（{fields['asp'] or 'ASP不明'}、{kind}、計測用画像{'あり' if pixel else 'なし'}）")
    return 0


def register(sub) -> dict:
    p = sub.add_parser("set-ad")
    p.add_argument("id")
    p.add_argument("code", help="広告コードを保存したファイル、または広告コード／URLそのもの")
    p.add_argument("--asp", default="")
    p.add_argument("--name", default="", help="提携したサービス名（CTAボックスに表示される）")
    p.add_argument("--cta", default="", help="ボタンの文言")
    return {"set-ad": cmd_set_ad}
