"""記事ごとのアイキャッチ画像（OGP兼用 1200×630 PNG）とロゴを生成する。

雑誌の表紙のような「文字組み」で見せるデザイン。カテゴリごとの落ち着いた単色の面に、
明朝体の見出しと、ブランド（コンパス）を表す細い同心円のラインだけを置く。
写真素材のライセンス問題や、いかにも生成っぽいイラストの違和感を避けるため。
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
INK = (27, 27, 27)
ACCENT = (179, 67, 43)

SERIF_BOLD = [
    ("/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc", 0),
    ("/usr/share/fonts/truetype/noto/NotoSerifCJK-Bold.ttc", 0),
]
SANS = [
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 0),
    ("/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", 0),
    ("/usr/share/fonts/truetype/fonts-japanese-gothic.ttf", 0),
    ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 0),
]
SANS_BOLD = [("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 0)] + SANS
NO_LINE_START = set("、。，．・：；？！）」』】〕｝〉》ー…ぁぃぅぇぉっゃゅょァィゥェォッャュョ")

LOGO_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{size}" height="{size}" aria-hidden="true">
<circle cx="32" cy="32" r="27" fill="none" stroke="{ring}" stroke-width="3"/>
<path d="M32 9 L37 32 L32 55 L27 32 Z" fill="{ring}"/>
<path d="M32 9 L37 32 L27 32 Z" fill="{accent}"/>
</svg>"""


def logo_svg(size: int = 32, ring: str = "currentColor", accent: str = "#b3432b", **_: str) -> str:
    return LOGO_SVG.format(size=size, ring=ring, accent=accent)


@lru_cache(maxsize=None)
def _find(candidates: tuple[tuple[str, int], ...]) -> tuple[str, int] | None:
    for path, index in candidates:
        if Path(path).exists():
            return path, index
    return None


def _font(candidates: list[tuple[str, int]], size: int) -> ImageFont.FreeTypeFont | None:
    src = _find(tuple(candidates))
    return ImageFont.truetype(src[0], size, index=src[1]) if src else None


def font(size: int) -> ImageFont.FreeTypeFont | None:
    return _font(SANS_BOLD, size)


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


def _compass_lines(d: ImageDraw.ImageDraw, cx: int, cy: int, color: tuple[int, int, int], scale: float = 1.0) -> None:
    """ブランドモチーフ：細い同心円と方位線（画面の右端で切れるように置く）。"""
    for r in (120, 200, 280, 360, 440):
        r = int(r * scale)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=2)
    reach = int(470 * scale)
    d.line([(cx - reach, cy), (cx + reach, cy)], fill=color, width=2)
    d.line([(cx, cy - reach), (cx, cy + reach)], fill=color, width=2)
    n = int(44 * scale)
    d.polygon([(cx, cy - int(200 * scale)), (cx + n // 2, cy), (cx, cy + int(200 * scale)), (cx - n // 2, cy)],
              outline=color, width=2)


def cover_image(title: str, category_name: str, category_slug: str, color: str, site_name: str,
                brand_en: str = "SKILL COMPASS") -> Image.Image:
    base = hex_rgb(color)
    img = Image.new("RGB", (W, H), base)
    d = ImageDraw.Draw(img)
    _compass_lines(d, 1080, 330, mix(base, (255, 255, 255), 0.10))

    f_title = _font(SERIF_BOLD, 64) or _font(SANS_BOLD, 60)
    f_sub = _font(SANS, 30)
    f_label = _font(SANS_BOLD, 24)
    white = (255, 255, 255)
    soft = mix(base, white, 0.72)
    if f_title is None or f_sub is None or f_label is None:
        return img

    # カテゴリ名（上）と細い線
    d.text((84, 84), category_name, font=f_label, fill=soft)
    d.line([(84, 128), (160, 128)], fill=mix(base, white, 0.5), width=2)

    main, _, sub = title.partition("｜")
    lines = wrap(main.strip(), f_title, 780, 3)
    sub_lines = wrap(sub.strip(), f_sub, 820, 2) if sub.strip() else []
    block_h = len(lines) * 92 + (len(sub_lines) * 46 + 22 if sub_lines else 0)
    y = max(170, 330 - block_h // 2)
    for line in lines:
        d.text((84, y), line, font=f_title, fill=white)
        y += 92
    y += 22
    for line in sub_lines:
        d.text((86, y), line, font=f_sub, fill=soft)
        y += 46

    # ブランド（下）
    f_brand = _font(SANS_BOLD, 22)
    x = 84
    for ch in brand_en:  # 字間を広げたロゴタイプ
        d.text((x, 526), ch, font=f_brand, fill=white)
        x += int(f_brand.getlength(ch)) + 6
    d.text((x + 18, 526), site_name, font=_font(SANS, 22), fill=soft)
    return img


def save_cover(path: Path, **kwargs) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cover_image(**kwargs).convert("P", palette=Image.ADAPTIVE, colors=64).save(path, "PNG", optimize=True)


def site_cover(site_name: str, tagline: str, brand_en: str = "SKILL COMPASS") -> Image.Image:
    base = (33, 37, 41)
    img = Image.new("RGB", (W, H), base)
    d = ImageDraw.Draw(img)
    _compass_lines(d, 1000, 315, (58, 63, 69))
    f_big = _font(SERIF_BOLD, 88) or _font(SANS_BOLD, 80)
    f_sub = _font(SANS, 32)
    f_brand = _font(SANS_BOLD, 26)
    if f_big and f_sub and f_brand:
        x = 84
        for ch in brand_en:
            d.text((x, 190), ch, font=f_brand, fill=(214, 120, 96))
            x += int(f_brand.getlength(ch)) + 8
        d.text((80, 240), site_name, font=f_big, fill=(255, 255, 255))
        y = 380
        for line in wrap(tagline, f_sub, 760, 2):
            d.text((84, y), line, font=f_sub, fill=(190, 195, 200))
            y += 50
    return img


def logo_png(size: int = 256) -> Image.Image:
    """構造化データ用の正方形ロゴ。"""
    img = Image.new("RGB", (size, size), (255, 255, 255))
    d = ImageDraw.Draw(img)
    c, r = size // 2, int(size * 0.42)
    d.ellipse([c - r, c - r, c + r, c + r], outline=INK, width=max(4, size // 24))
    d.polygon([(c, c - r * 0.85), (c + r * 0.19, c), (c, c + r * 0.85), (c - r * 0.19, c)], fill=INK)
    d.polygon([(c, c - r * 0.85), (c + r * 0.19, c), (c - r * 0.19, c)], fill=ACCENT)
    return img
