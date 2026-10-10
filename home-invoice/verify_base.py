# 新しい請求書が「ひな形から意図した所だけ」変わっているか、レコード単位で突き合わせる
# 使い方: python3 -I verify_base.py <ひな形.xls> <出来上がり.xls>
import sys, struct, olefile, xlrd
a, b = sys.argv[1], sys.argv[2]
def recs(p):
    wb = olefile.OleFileIO(p).openstream('Workbook').read()
    out, pos = [], 0
    while pos < len(wb):
        t, l = struct.unpack_from('<HH', wb, pos); out.append((t, wb[pos+4:pos+4+l], pos)); pos += 4 + l
    return wb, out
wa, ra = recs(a); wb_, rb = recs(b)
print('レコード数', len(ra), '->', len(rb), ' 長さ', len(wa), '->', len(wb_))
# 位置に依存する3種(シート位置・INDEX・ExtSST)と SST は別に検証する
SKIP = {0x85, 0x20b, 0xff, 0xfc}
ia = ib = 0; diffs = []
while ia < len(ra) and ib < len(rb):
    ta, da, pa = ra[ia]; tb, db, pb = rb[ib]
    if ta == tb and (da == db or ta in SKIP):
        ia += 1; ib += 1; continue
    if ta == tb:
        diffs.append((ta, pa, 'changed', da, db)); ia += 1; ib += 1
    else:
        diffs.append((ta, pa, 'removed', da, b'')); ia += 1
print('ひな形と違うレコード:')
for t, p, k, da, db in diffs:
    desc = ''
    if t in (0x27e, 0x203, 0x06, 0xfd): desc = 'セル 行%d 列%d' % (struct.unpack_from('<H', da, 0)[0]+1, struct.unpack_from('<H', da, 2)[0]+1)
    print(' ', hex(t), k, desc)
# 位置参照の検証
def check(path):
    wb, r = recs(path); at = {p: t for t, _, p in r}
    ok = True
    for t, d, p in r:
        if t == 0x85:
            ok &= at.get(struct.unpack_from('<I', d, 0)[0]) == 0x809
        if t == 0x20b:
            ok &= at.get(struct.unpack_from('<I', d, 12)[0]) == 0x55
            for k in range((len(d)-16)//4): ok &= at.get(struct.unpack_from('<I', d, 16+4*k)[0]) == 0xd7
    return ok
print('位置参照(シート/INDEX)がレコード先頭を指す:', check(a), '->', check(b))
# 文字セルの突き合わせ(xlrd)
xa = xlrd.open_workbook(a, formatting_info=True); xb = xlrd.open_workbook(b, formatting_info=True)
sa, sb = xa.sheet_by_index(0), xb.sheet_by_index(0)
assert (sa.nrows, sa.ncols) == (sb.nrows, sb.ncols)
print('書式(セルごとの書式番号・罫線)の不一致:', sum(1 for r in range(sa.nrows) for c in range(sa.ncols) if sa.cell_xf_index(r, c) != sb.cell_xf_index(r, c)))
print('列幅/行高/結合セルの一致:', sa.colinfo_map.keys() == sb.colinfo_map.keys() and all(sa.colinfo_map[k].width == sb.colinfo_map[k].width for k in sa.colinfo_map), all(sa.rowinfo_map[k].height == sb.rowinfo_map[k].height for k in sa.rowinfo_map), sa.merged_cells == sb.merged_cells)
print('セルの値の変更:')
for r in range(sa.nrows):
    for c in range(sa.ncols):
        va, vb = sa.cell_value(r, c), sb.cell_value(r, c)
        if va != vb: print('  R%dC%d' % (r+1, c+1), repr(va), '->', repr(vb))
