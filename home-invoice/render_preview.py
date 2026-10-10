"""請求書(.xls)を「印刷したらこう見える」に近い形でPDF/PNGにする確認用プレビュー。
ExcelもLibreOfficeも使えない環境用の簡易描画。次を反映する:
  印刷範囲(Print_Area)・用紙(A4)・倍率・余白・中央寄せ・罫線・列幅/行高・結合セル・図形(テキストボックス)の位置と文字。
ひな形を同じ描画に通して見比べる使い方を想定(差があるのは書き換えた所だけのはず)。
使い方: python3 -I render_preview.py <in.xls> <out.pdf> [out.png]
"""
import datetime
import struct
import sys

import olefile
import pymupdf
import xlrd
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
FONT = 'HeiseiKakuGo-W5'
src, out = sys.argv[1], sys.argv[2]
png = sys.argv[3] if len(sys.argv) > 3 else None
book = xlrd.open_workbook(src, formatting_info=True)
s = book.sheet_by_index(0)

# ---- BIFF から印刷設定・図形を読む ----
wb = olefile.OleFileIO(src).openstream('Workbook').read()
recs, pos = [], 0
while pos < len(wb):
    t, l = struct.unpack_from('<HH', wb, pos)
    recs.append((t, wb[pos + 4:pos + 4 + l]))
    pos += 4 + l
bof = [i for i, r in enumerate(recs) if r[0] == 0x809]
sheet1 = recs[bof[1]:bof[2]]
area = (0, 59, 0, 43)
for t, d in recs[:bof[1]]:
    if t == 0x18 and len(d) > 20 and d[15] == 6 and d[16] == 0x3b:
        area = struct.unpack_from('<HHHH', d, 19)  # 行開始,行終了,列開始,列終了
r0, r1, c0, c1 = area
scale, margins, hcenter, vcenter = 100, [0.75] * 4, 0, 0
for t, d in sheet1:
    if t == 0xA1: scale = struct.unpack_from('<H', d, 2)[0]
    if t in (0x26, 0x27, 0x28, 0x29): margins[t - 0x26] = struct.unpack('<d', d)[0]
    if t == 0x83: hcenter = struct.unpack('<H', d)[0]
    if t == 0x84: vcenter = struct.unpack('<H', d)[0]
# 図形: Escherの ClientAnchor を順に、TXO(テキストボックス)の文字を順に対応づける
anchors, texts = [], []
for i, (t, d) in enumerate(sheet1):
    if t in (0xEC, 0x3C):
        j = d.find(b'\x10\xf0')
        while j >= 0:
            if d[j + 2:j + 6] == struct.pack('<I', 18) and j >= 2 and (struct.unpack_from('<H', d, j - 2)[0] & 0xF) == 0:
                anchors.append(struct.unpack_from('<9H', d, j + 6)[1:])
            j = d.find(b'\x10\xf0', j + 1)
    if t == 0x1B6:
        cch = struct.unpack_from('<H', d, 10)[0]
        n = sheet1[i + 1][1] if cch else b''
        texts.append(bytes(n[1:]).decode('utf-16-le' if n[0] & 1 else 'latin1') if cch else '')

# ---- 寸法(pt) ----
def colw(c):
    ci = s.colinfo_map.get(c)
    return (ci.width if ci else s.defcolwidth * 256 if s.defcolwidth else 8.43 * 256) / 256 * 7 * 0.75
def rowh(r):
    ri = s.rowinfo_map.get(r)
    return (ri.height if ri and ri.height else s.default_row_height) / 20
xs = [0]; [xs.append(xs[-1] + colw(c)) for c in range(c0, c1 + 1)]
ys = [0]; [ys.append(ys[-1] + rowh(r)) for r in range(r0, r1 + 1)]
W, H = xs[-1] * scale / 100, ys[-1] * scale / 100
pw, ph = A4
ml, mr, mt, mb = [m * 72 for m in margins]
ox = ml + ((pw - ml - mr - W) / 2 if hcenter else 0)
oy = mt + ((ph - mt - mb - H) / 2 if vcenter else 0)
sc = scale / 100
fits = W <= pw - ml - mr + 1 and H <= ph - mt - mb + 1
X = lambda c: ox + xs[c - c0] * sc
Y = lambda r: ph - oy - ys[r - r0] * sc
cv = canvas.Canvas(out, pagesize=A4)
cv.setLineWidth(0.3); cv.setStrokeGray(0.75); cv.rect(0, 0, pw, ph)  # 用紙の縁
cv.setStrokeGray(0)

def line(x1, y1, x2, y2, st):
    if st in (0, 3, 4, 7, 8, 9, 10, 11, 12, 13): return
    cv.setLineWidth(0.9 if st in (2, 5) else 0.5); cv.line(x1, y1, x2, y2)
for r in range(r0, r1 + 1):
    for c in range(c0, c1 + 1):
        bd = book.xf_list[s.cell_xf_index(r, c)].border
        line(X(c), Y(r), X(c + 1), Y(r), bd.top_line_style); line(X(c), Y(r + 1), X(c + 1), Y(r + 1), bd.bottom_line_style)
        line(X(c), Y(r), X(c), Y(r + 1), bd.left_line_style); line(X(c + 1), Y(r), X(c + 1), Y(r + 1), bd.right_line_style)
merge = {(a, c): (b, d) for (a, b, c, d) in s.merged_cells}
for r in range(r0, r1 + 1):
    for c in range(c0, c1 + 1):
        v = s.cell_value(r, c)
        if v == '' or v is None: continue
        xf = book.xf_list[s.cell_xf_index(r, c)]
        rr, cc = merge.get((r, c), (r + 1, c + 1))
        ct = s.cell_type(r, c)
        if ct == xlrd.XL_CELL_DATE:
            d = datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v)); t = f'{d.year}/{d.month}/{d.day}'
        elif ct == xlrd.XL_CELL_NUMBER: t = f'{int(v):,}' if float(v).is_integer() else f'{v:,}'
        else: t = str(v)
        size = max(4, book.font_list[xf.font_index].height / 20 * sc)
        cv.setFont(FONT, size)
        x1, x2, yt, yb = X(c), X(min(cc, c1 + 1)), Y(r), Y(min(rr, r1 + 1))
        ha, va = xf.alignment.hor_align, xf.alignment.vert_align
        w = cv.stringWidth(t, FONT, size)
        num = ct in (xlrd.XL_CELL_NUMBER, xlrd.XL_CELL_DATE)
        tx = x2 - 2 - w if ha == 3 or (ha == 0 and num) else (x1 + x2) / 2 - w / 2 if ha in (2, 6) else x1 + 2
        ty = yb + 2 if va == 2 else yt - size - 1 if va == 0 else (yt + yb) / 2 - size * 0.35
        cv.drawString(tx, ty, t)
# 図形(テキストボックス)
for (cA, dxA, rA, dyA, cB, dxB, rB, dyB), tx in zip(anchors, texts):
    if cA > c1 or cB < c0: continue
    cw = lambda c: xs[min(max(c, c0), c1 + 1) - c0] if c <= c1 else xs[-1]
    x1 = X(cA) + colw(cA) * sc * dxA / 1024; x2 = X(cB) + colw(cB) * sc * dxB / 1024
    y1 = Y(rA) - rowh(rA) * sc * dyA / 256; y2 = Y(rB) - rowh(rB) * sc * dyB / 256
    cv.setLineWidth(0.5); cv.setStrokeGray(0.3)
    cv.rect(x1, y2, x2 - x1, y1 - y2, stroke=1, fill=0)
    fs = 5.2 * sc; cv.setFont(FONT, fs); cy = y1 - fs - 1
    for ln in tx.split('\n'):
        while ln:
            k = len(ln)
            while k > 1 and cv.stringWidth(ln[:k], FONT, fs) > x2 - x1 - 4: k -= 1
            cv.drawString(x1 + 2, cy, ln[:k]); ln = ln[k:]; cy -= fs + 1
cv.save()
print('印刷範囲 行%d-%d 列%d-%d / 倍率%d%% / 用紙A4 / 1ページに収まる: %s' % (r0 + 1, r1 + 1, c0 + 1, c1 + 1, scale, 'はい' if fits else 'いいえ(はみ出し)'))
if png:
    pdf = pymupdf.open(out); pdf[0].get_pixmap(dpi=100).save(png)
