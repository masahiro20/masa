"""記事ごとのアイキャッチ画像（OGP兼用 1200×630 PNG）とロゴを生成する。

写真素材のライセンスや「それっぽいAI画像」の違和感を避けるため、カテゴリごとの
オリジナル図形イラスト＋タイトルで統一感のあるブランドビジュアルを作る。
日本語フォントが見つからない環境ではタイトル文字なしの図形のみで生成する。
"""
from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
NAVY = (22, 34, 56)
MUTED = (92, 102, 118)
PAPER = (251, 250, 247)

FONT_CANDIDATES = [
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJKjp-Bold.otf", 0),
    ("/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc", 0),
    ("/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", 0),
    ("/usr/share/fonts/truetype/fonts-japanese-gothic.ttf", 0),
    ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 0),
]
NO_LINE_START = set("、。，．・：；？！）」』】〕｝〉》ー…ぁぃぅぇぉっゃゅょァィゥェォッャュョ")

LOGO_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{size}" height="{size}" aria-hidden="true">
<circle cx="32" cy="32" r="28" fill="none" stroke="{ring}" stroke-width="5"/>
<path d="M32 10 L39 32 L32 54 L25 32 Z" fill="{needle}"/>
<path d="M32 10 L39 32 L25 32 Z" fill="{accent}"/>
<circle cx="32" cy="32" r="4" fill="{ring}"/>
</svg>"""


def logo_svg(size: int = 32, ring: str = "currentColor", needle: str = "currentColor", accent: str = "#e0662a") -> str:
    return LOGO_SVG.format(size=size, ring=ring, needle=needle, accent=accent)


@lru_cache(maxsize=None)
def _font_source() -> tuple[str, int] | None:
    for path, index in FONT_CANDIDATES:
        if Path(path).exists():
            return path, index
    return None


def font(size: int) -> ImageFont.FreeTypeFont | None:
    src = _font_source()
    if not src:
        return None
    return ImageFont.truetype(src[0], size, index=src[1])


def hex_rgb(color: str) -> tuple[int, int, int]:
    c = color.lstrip("#")
    return tuple(int(c[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))  # type: ignore[return-value]


def wrap(text: str, fnt: ImageFont.FreeTypeFont, max_width: int, max_lines: int) -> list[str]:
    """日本語を文字単位で折り返す。最終行が1〜2文字だけになる「泣き別れ」は幅を詰めて避ける。"""
    lines = _wrap(text, fnt, max_width, max_lines)
    if len(lines) > 1 and len(lines[-1]) <= 2:
        for w in range(max_width - 20, int(max_width * 0.6), -20):
            trial = _wrap(text, fnt, w, max_lines)
            if len(trial) == len(lines) and len(trial[-1]) > 2 and not trial[-1].endswith("…"):
                return trial
    return lines


def _wrap(text: str, fnt: ImageFont.FreeTypeFont, max_width: int, max_lines: int) -> list[str]:
    """日本語を文字単位で折り返す（行頭禁則つき）。入りきらなければ末尾を「…」にする。"""
    lines, line = [], ""
    for ch in text:
        if fnt.getlength(line + ch) <= max_width or not line:
            line += ch
            continue
        if ch in NO_LINE_START:  # 行頭に来てはいけない文字は前の行に追い込む
            line += ch
            continue
        lines.append(line)
        line = ch
    if line:
        lines.append(line)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and fnt.getlength(last + "…") > max_width:
            last = last[:-1]
        lines[-1] = last + "…"
    return lines


def _motif(d: ImageDraw.ImageDraw, kind: str, color: tuple[int, int, int], ox: int, oy: int) -> None:
    """カテゴリを表す図形イラスト（右側 360×360 の領域）。"""
    light = mix(color, (255, 255, 255), 0.72)
    mid = mix(color, (255, 255, 255), 0.35)
    white = (255, 255, 255)
    d.ellipse([ox, oy, ox + 360, oy + 360], fill=light)
    if kind == "school":  # ノートPCと吹き出しのコード
        d.rounded_rectangle([ox + 70, oy + 95, ox + 290, oy + 235], 14, fill=color)
        d.rounded_rectangle([ox + 84, oy + 109, ox + 276, oy + 221], 6, fill=white)
        for i, w in enumerate((120, 150, 90, 130)):
            d.rounded_rectangle([ox + 102, oy + 124 + i * 22, ox + 102 + w, oy + 134 + i * 22], 5,
                                fill=mid if i % 2 else color)
        d.polygon([(ox + 40, oy + 250), (ox + 320, oy + 250), (ox + 300, oy + 270), (ox + 60, oy + 270)], fill=NAVY)
    elif kind == "career":  # 階段と上向き矢印
        for i in range(4):
            x = ox + 60 + i * 60
            top = oy + 260 - (i + 1) * 45
            d.rectangle([x, top, x + 60, oy + 270], fill=color if i % 2 == 0 else mid)
        d.line([(ox + 80, oy + 190), (ox + 280, oy + 70)], fill=NAVY, width=14)
        d.polygon([(ox + 300, oy + 58), (ox + 250, oy + 62), (ox + 283, oy + 102)], fill=NAVY)
    elif kind == "tools":  # サーバーラック
        for i in range(3):
            y = oy + 80 + i * 70
            d.rounded_rectangle([ox + 90, y, ox + 270, y + 56], 10, fill=color if i != 1 else NAVY)
            d.ellipse([ox + 108, y + 20, ox + 124, y + 36], fill=white)
            d.ellipse([ox + 132, y + 20, ox + 148, y + 36], fill=mid)
            for j in range(3):
                d.rounded_rectangle([ox + 180 + j * 26, y + 16, ox + 194 + j * 26, y + 40], 3, fill=light)
    else:  # learning: 開いた本と電球
        d.polygon([(ox + 60, oy + 150), (ox + 180, oy + 175), (ox + 180, oy + 285), (ox + 60, oy + 260)], fill=color)
        d.polygon([(ox + 300, oy + 150), (ox + 180, oy + 175), (ox + 180, oy + 285), (ox + 300, oy + 260)], fill=mid)
        d.ellipse([ox + 140, oy + 45, ox + 220, oy + 125], fill=(255, 196, 61))
        d.rounded_rectangle([ox + 163, oy + 120, ox + 197, oy + 142], 5, fill=NAVY)
        for dx, dy in ((-60, -10), (60, -10), (0, -55)):
            cx, cy = ox + 180 + dx, oy + 85 + dy
            d.line([(cx, cy), (cx + dx * 0.25, cy + dy * 0.25)], fill=(255, 196, 61), width=8)


def _logo_mark(d: ImageDraw.ImageDraw, x: int, y: int, r: int) -> None:
    d.ellipse([x - r, y - r, x + r, y + r], outline=NAVY, width=max(3, r // 6))
    d.polygon([(x, y - r * 0.72), (x + r * 0.24, y), (x, y + r * 0.72), (x - r * 0.24, y)], fill=NAVY)
    d.polygon([(x, y - r * 0.72), (x + r * 0.24, y), (x - r * 0.24, y)], fill=(224, 102, 42))


def cover_image(title: str, category_name: str, category_slug: str, color: str, site_name: str) -> Image.Image:
    base = hex_rgb(color)
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    # 背景: 淡い色面と装飾の円（タイトルごとに位置を少し変えて単調にしない）
    seed = int(hashlib.md5(title.encode()).hexdigest()[:6], 16)
    d.rectangle([0, 0, W, H], fill=mix(base, PAPER, 0.93))
    d.ellipse([-160 + seed % 80, 380, 240 + seed % 80, 780], fill=mix(base, PAPER, 0.82))
    d.rectangle([0, 0, 18, H], fill=base)
    _motif(d, category_slug, base, 790, 120)

    f_chip, f_title, f_sub, f_site = font(30), font(60), font(34), font(30)
    if f_chip is None:
        _logo_mark(d, 100, 560, 26)
        return img

    chip_w = int(f_chip.getlength(category_name)) + 44
    d.rounded_rectangle([80, 70, 80 + chip_w, 124], 27, fill=base)
    d.text((102, 97), category_name, font=f_chip, fill=(255, 255, 255), anchor="lm")

    main, _, sub = title.partition("｜")
    lines = wrap(main.strip(), f_title, 660, 3)
    y = 170
    for line in lines:
        d.text((80, y), line, font=f_title, fill=NAVY)
        y += 84
    if sub.strip():
        for line in wrap(sub.strip(), f_sub, 660, 2):
            d.text((82, y + 8), line, font=f_sub, fill=MUTED)
            y += 50

    _logo_mark(d, 104, 556, 26)
    d.text((146, 556), site_name, font=f_site, fill=NAVY, anchor="lm")
    return img


def save_cover(path: Path, **kwargs) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cover_image(**kwargs).save(path, "PNG", optimize=True)


def site_cover(site_name: str, tagline: str) -> Image.Image:
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)
    d.ellipse([760, -120, 1320, 440], fill=(32, 50, 80))
    d.ellipse([880, 300, 1260, 680], fill=(28, 44, 70))
    f_big, f_sub = font(72), font(34)
    cx, cy, r = 1010, 300, 150
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255), width=18)
    d.polygon([(cx, cy - r * 0.75), (cx + r * 0.25, cy), (cx, cy + r * 0.75), (cx - r * 0.25, cy)], fill=(255, 255, 255))
    d.polygon([(cx, cy - r * 0.75), (cx + r * 0.25, cy), (cx - r * 0.25, cy)], fill=(224, 102, 42))
    if f_big:
        y = 210
        for line in wrap(site_name, f_big, 640, 2):
            d.text((80, y), line, font=f_big, fill=(255, 255, 255))
            y += 96
        for line in wrap(tagline, f_sub, 640, 3):
            d.text((82, y + 20), line, font=f_sub, fill=(200, 210, 225))
            y += 50
    return img
