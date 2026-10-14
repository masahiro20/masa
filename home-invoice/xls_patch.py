"""ホームランディックの請求書(.xls)を、ひな形そのままに「中身だけ」差し替える道具。

xlutils/xlwt で読み書きし直すと、図形(会社名の枠・押印枠)、印刷設定、罫線の細部が落ちる。
そこで .xls(BIFF8)の中身を直接書き換える。触るのは次の3つだけ。
  1. 文字セルの文字(共有文字列表の該当エントリ)
  2. 数値セルの値(RK形式の整数)
  3. 数式セルの「計算済みの値」(数式そのものは触らない)
  4. 使わない明細行のセルを空にする(clear)
  5. テキストボックスの文字の一部を消す(textbox_delete)／文字を全部空にする(blank_textboxes)
それ以外のレコード(書式・罫線・列幅・印刷設定・図形)は1バイトも変えない。
ズレる絶対位置(シート位置・INDEX・DBCELL・ExtSST)だけ計算し直す。

使い方: python3 -I xls_patch.py <設定JSON>   (設定JSONの形は README.md)
個人情報(住所・氏名)はこのリポジトリに置かない。設定JSONは作業用の場所に作る。
"""
import json
import struct
import sys
import uuid

import olefile

SST, EXTSST, CONTINUE, BOUNDSHEET, INDEX, DBCELL = 0xFC, 0xFF, 0x3C, 0x85, 0x20B, 0xD7
LABELSST, RK, NUMBER, FORMULA, TXO, BOF = 0xFD, 0x27E, 0x203, 0x06, 0x1B6, 0x809
BLANK, ROW = 0x201, 0x208


# ---------- BIFF レコード ----------
def parse_records(wb):
    recs, pos = [], 0
    while pos < len(wb):
        t, l = struct.unpack_from('<HH', wb, pos)
        recs.append([t, bytearray(wb[pos + 4:pos + 4 + l]), pos])
        pos += 4 + l
    assert pos == len(wb), 'レコードの長さが合わない'
    return recs


def serialize(recs):
    out, newpos = bytearray(), []
    for t, d, _ in recs:
        newpos.append(len(out))
        out += struct.pack('<HH', t, len(d)) + bytes(d)
    return bytes(out), newpos


# ---------- 共有文字列表(SST) ----------
def parse_sst(payload):
    total, unique = struct.unpack_from('<II', payload, 0)
    off, entries = 8, []
    for _ in range(unique):
        start = off
        cch, flags = struct.unpack_from('<HB', payload, off)
        off += 3
        crun = cext = 0
        if flags & 8:
            crun = struct.unpack_from('<H', payload, off)[0]
            off += 2
        if flags & 4:
            cext = struct.unpack_from('<I', payload, off)[0]
            off += 4
        wide = flags & 1
        chars = payload[off:off + cch * (2 if wide else 1)]
        off += len(chars) + 4 * crun + cext
        text = chars.decode('utf-16-le' if wide else 'latin1')
        entries.append({'raw': bytes(payload[start:off]), 'text': text})
    assert off == len(payload), 'SSTが複数レコードにまたがっている(未対応)'
    return total, unique, entries


def encode_string(text):
    wide = any(ord(ch) > 0xFF for ch in text)
    body = text.encode('utf-16-le') if wide else text.encode('latin1')
    return struct.pack('<HB', len(text), 1 if wide else 0) + body


def build_sst(total, unique, entries):
    payload = bytearray(struct.pack('<II', total, unique))
    offsets = []
    for e in entries:
        offsets.append(len(payload))
        payload += e['raw']
    assert len(payload) <= 8224, 'SSTが大きすぎる(未対応)'
    return payload, offsets


def build_extsst(old_payload, sst_pos, offsets):
    dsst = struct.unpack_from('<H', old_payload, 0)[0]
    out = bytearray(struct.pack('<H', dsst))
    for k in range(0, len(offsets), dsst):
        ib = sst_pos + 4 + offsets[k]
        out += struct.pack('<IHH', ib, 4 + offsets[k], 0)
    return out


# ---------- 複合ファイル(CFB) ----------
def write_cfb(path, streams, root_clsid):
    """streams: [(name, bytes)] 全部4096バイト以上(通常セクタ)であること"""
    S = 512
    for n, d in streams:
        assert len(d) >= 4096, n
    order = sorted(streams, key=lambda x: (len(x[0]), x[0].upper()))
    sec_counts = [(len(d) + S - 1) // S for _, d in order]
    ndir_sec = (len(order) + 1 + 3) // 4
    nfat = 1
    while True:
        total = sum(sec_counts) + ndir_sec + nfat
        if nfat * 128 >= total:
            break
        nfat += 1
    assert nfat <= 109
    fat = [0xFFFFFFFF] * (nfat * 128)
    secs, nxt = [], 0
    starts = []
    for (name, d), cnt in zip(order, sec_counts):
        starts.append(nxt)
        for i in range(cnt):
            fat[nxt + i] = nxt + i + 1 if i < cnt - 1 else 0xFFFFFFFE
        buf = bytes(d) + b'\0' * (cnt * S - len(d))
        secs.append(buf)
        nxt += cnt
    dir_start = nxt
    for i in range(ndir_sec):
        fat[nxt + i] = nxt + i + 1 if i < ndir_sec - 1 else 0xFFFFFFFE
    nxt += ndir_sec
    fat_start = nxt
    for i in range(nfat):
        fat[nxt + i] = 0xFFFFFFFD
    entries = []

    # ディレクトリ項目(128バイト)を明示的に組み立てる
    def entry(name, typ, left, right, child, start, size, clsid=b'\0' * 16):
        nm = name.encode('utf-16-le')
        b = bytearray(128)
        b[0:len(nm)] = nm
        struct.pack_into('<H', b, 64, len(nm) + 2 if name else 0)
        b[66] = typ
        b[67] = 1  # 黒
        struct.pack_into('<III', b, 68, left, right, child)
        b[80:96] = clsid
        struct.pack_into('<I', b, 116, start)
        struct.pack_into('<I', b, 120, size)
        return bytes(b)
    NOSTREAM = 0xFFFFFFFF
    n = len(order)
    # 並び順(長さ→大文字小文字無視)で、真ん中を根の子にして左右へつなぐ
    mid = n // 2
    left = {mid: mid - 1} if mid - 1 >= 0 else {}
    right = {mid: mid + 1} if mid + 1 < n else {}
    ents = [entry('Root Entry', 5, NOSTREAM, NOSTREAM, 1 + mid, 0xFFFFFFFE, 0, root_clsid)]
    for i, ((name, d), st) in enumerate(zip(order, starts)):
        l = 1 + left[i] if i in left else NOSTREAM
        r = 1 + right[i] if i in right else NOSTREAM
        ents.append(entry(name, 2, l, r, NOSTREAM, st, len(d)))
    while len(ents) < ndir_sec * 4:
        b = bytearray(128)
        struct.pack_into('<III', b, 68, NOSTREAM, NOSTREAM, NOSTREAM)
        ents.append(bytes(b))
    dir_bytes = b''.join(ents)
    fat_bytes = b''.join(struct.pack('<I', x) for x in fat)
    hdr = bytearray(512)
    hdr[0:8] = bytes.fromhex('D0CF11E0A1B11AE1')
    struct.pack_into('<HHHHH', hdr, 24, 0x3E, 3, 0xFFFE, 9, 6)
    struct.pack_into('<IIIIIIII', hdr, 40, 0, nfat, dir_start, 0, 4096, 0xFFFFFFFE, 0, 0xFFFFFFFE)
    for i in range(109):
        struct.pack_into('<I', hdr, 76 + 4 * i, fat_start + i if i < nfat else 0xFFFFFFFF)
    with open(path, 'wb') as f:
        f.write(bytes(hdr))
        for s in secs:
            f.write(s)
        f.write(dir_bytes)
        f.write(fat_bytes)



def recompute_dbcell(recs, sheet_index=1):
    """シート1の DBCELL(行ごとの先頭セル位置の表)を、いまのレコード配置から作り直す"""
    data, pos = serialize(recs)
    bofs = [i for i, r in enumerate(recs) if r[0] == BOF]
    end = bofs[sheet_index + 1] if sheet_index + 1 < len(bofs) else len(recs)
    block_start = None
    i = bofs[sheet_index]
    cellkinds = (LABELSST, RK, NUMBER, FORMULA, BLANK, 0xBE, 0x204)
    while i < end:
        if recs[i][0] == ROW and (i == 0 or recs[i - 1][0] != ROW):
            block_start = i
        if recs[i][0] == DBCELL:
            j = block_start
            rows = []
            while recs[j][0] == ROW:
                rows.append(j); j += 1
            first_cell = {}
            for k in range(j, i):
                if recs[k][0] in cellkinds:
                    r = struct.unpack_from('<H', recs[k][1], 0)[0]
                    first_cell.setdefault(r, pos[k])
            cell_rows = sorted(first_cell)
            old = recs[i][1]
            n = (len(old) - 4) // 2
            old_rg = list(struct.unpack_from('<%dH' % n, old, 4))
            nz = [k for k, v in enumerate(old_rg) if v]
            new_rg = list(old_rg)
            dbr = pos[i] - pos[rows[0]]
            if len(nz) == len(cell_rows):
                prev = pos[rows[0]] + 4 + len(recs[rows[0]][1])
                for k, r in zip(nz, cell_rows):
                    new_rg[k] = first_cell[r] - prev
                    prev = first_cell[r]
            else:
                # 表の形が想定と違うブロックは、中身のサイズが変わっていない場合だけ許す
                assert dbr == struct.unpack_from('<I', old, 0)[0], 'DBCELLの形が想定と違い、サイズも変わっている'
            recs[i][1] = bytearray(struct.pack('<I', dbr) + struct.pack('<%dH' % n, *new_rg))
        i += 1


def edit_textbox(recs, delete, blank):
    """テキストボックスの文字を直す。delete=消す文字列のリスト、blank=含まれていたら全部空にする文字列のリスト"""
    drop = set()
    for i, (t, d, _) in enumerate(recs):
        if t != TXO:
            continue
        text = txo_text(recs, i)
        if not text:
            continue
        new = None
        if any(k in text for k in blank):
            new = ''
        for k in delete:
            if k in text:
                new = (text if new is None else new).replace(k, '', 1)
        if new is None:
            continue
        runs_d = recs[i + 2][1]
        runs = [struct.unpack_from('<HH', runs_d, o) for o in range(0, len(runs_d), 8)]
        if not new:
            struct.pack_into('<HH', d, 10, 0, 0)
            drop |= {i + 1, i + 2}
            continue
        # 消した文字数ぶん、書式の切り替え位置を前へずらす
        cut = text.index(next(k for k in delete if k in text))
        n_del = len(text) - len(new)
        def shift(ich):
            return ich if ich <= cut else max(cut, ich - n_del)
        newruns = {}
        for ich, fnt in runs:
            newruns[shift(ich)] = fnt
        newruns[len(new)] = runs[-1][1]
        ordered = sorted(newruns.items())
        wide = any(ord(ch) > 0xFF for ch in new)
        recs[i + 1][1] = bytearray(bytes([1 if wide else 0]) + (new.encode('utf-16-le') if wide else new.encode('latin1')))
        recs[i + 2][1] = bytearray(b''.join(struct.pack('<HHI', a, b, 0) for a, b in ordered))
        struct.pack_into('<HH', d, 10, len(new), 8 * len(ordered))
    return [r for i, r in enumerate(recs) if i not in drop]


# ---------- 本体 ----------
def cell_index(recs, kinds):
    """シート1のセル記録 {(行,列)(1始まり): レコード番号}"""
    bofs = [i for i, r in enumerate(recs) if r[0] == BOF]
    idx = {}
    for i in range(bofs[1], bofs[2]):
        t, d, _ = recs[i]
        if t in kinds:
            r, c = struct.unpack_from('<HH', d, 0)
            idx[(r + 1, c + 1)] = i
    return idx


def rk_encode(v):
    assert float(v).is_integer() and 0 <= v < (1 << 29), '整数のみ対応: %r' % v
    return struct.pack('<I', (int(v) << 2) | 2)


def txo_text(recs, i):
    cch = struct.unpack_from('<H', recs[i][1], 10)[0]
    if not cch:
        return ''
    d = recs[i + 1][1]
    return bytes(d[1:]).decode('utf-16-le' if d[0] & 1 else 'latin1')


def patch(src, dst, strings, numbers, formulas, blank_textboxes, forbid, clear=(), textbox_delete=()):
    o = olefile.OleFileIO(src)
    wb = o.openstream('Workbook').read()
    other = [(n, o.openstream(n).read()) for n in o.listdir() if n != ['Workbook']]
    other = [('/'.join(n), d) for n, d in other]
    clsid = uuid.UUID(o.root.clsid).bytes_le if o.root.clsid else b'\0' * 16
    o.close()
    recs = parse_records(wb)
    sst_i = next(i for i, r in enumerate(recs) if r[0] == SST)
    total, unique, entries = parse_sst(recs[sst_i][1])
    cells = cell_index(recs, (LABELSST, RK, NUMBER, FORMULA, BLANK))

    # 1. 文字
    refs = {}
    for k, i in cells.items():
        if recs[i][0] == LABELSST:
            refs.setdefault(struct.unpack_from('<I', recs[i][1], 6)[0], []).append(k)
    orphaned = set()
    for (r, c), text in strings.items():
        i = cells[(r, c)]
        assert recs[i][0] == LABELSST, '文字セルではない: %s' % ((r, c),)
        isst = struct.unpack_from('<I', recs[i][1], 6)[0]
        if entries[isst]['text'] == text:
            continue  # 同じ文字なら触らない
        if len(refs[isst]) == 1:
            entries[isst]['raw'] = encode_string(text)
            entries[isst]['text'] = text
        else:
            entries.append({'raw': encode_string(text), 'text': text})
            struct.pack_into('<I', recs[i][1], 6, len(entries) - 1)
            refs[isst].remove((r, c))
            unique += 1
    # 2. 数値
    for (r, c), v in numbers.items():
        i = cells[(r, c)]
        assert recs[i][0] == RK, '数値(RK)セルではない: %s' % ((r, c),)
        recs[i][1][6:10] = rk_encode(v)
    # 3. 数式の計算済みの値(数式は触らない)
    for (r, c), v in formulas.items():
        i = cells[(r, c)]
        assert recs[i][0] == FORMULA, '数式セルではない: %s' % ((r, c),)
        recs[i][1][6:14] = struct.pack('<d', float(v))
    # 4. 使わない明細行のセルを空にする(書式はそのまま)
    for (r, c) in clear:
        i = cells[(r, c)]
        assert recs[i][0] in (LABELSST, RK, NUMBER), '空にできるのは文字・数値セルだけ: %s' % ((r, c),)
        if recs[i][0] == LABELSST:
            isst = struct.unpack_from('<I', recs[i][1], 6)[0]
            refs[isst].remove((r, c))
            if not refs[isst]:
                orphaned.add(isst)
        recs[i][0] = BLANK
        recs[i][1] = bytearray(recs[i][1][:6])
    # 前のお客様の文字だけが入っていた共有文字列は取り除き、番号を詰める
    if orphaned:
        keep = [k for k in range(len(entries)) if k not in orphaned]
        remap = {old: new for new, old in enumerate(keep)}
        for r in recs:
            if r[0] == LABELSST:
                old = struct.unpack_from('<I', r[1], 6)[0]
                struct.pack_into('<I', r[1], 6, remap[old])
        entries = [entries[k] for k in keep]
        unique = len(entries)
        total -= len(orphaned)
    # 5. テキストボックス
    recs = edit_textbox(recs, textbox_delete, blank_textboxes)
    sst_i = next(i for i, r in enumerate(recs) if r[0] == SST)
    ext_i = next(i for i, r in enumerate(recs) if r[0] == EXTSST)

    # 6. SST/ExtSST を作り直し、位置ズレを直す
    old_pos = [r[2] for r in recs]
    payload, offsets = build_sst(total, unique, entries)
    recs[sst_i][1] = payload
    old_ext = bytes(recs[ext_i][1])
    new_pos_probe = serialize(recs)[1]
    recs[ext_i][1] = build_extsst(old_ext, new_pos_probe[sst_i], offsets)
    recompute_dbcell(recs)
    data, new_pos = serialize(recs)
    pos_map = dict(zip(old_pos, new_pos))
    for t, d, _ in recs:
        if t == BOUNDSHEET:
            struct.pack_into('<I', d, 0, pos_map[struct.unpack_from('<I', d, 0)[0]])
        elif t == INDEX:
            n = (len(d) - 16) // 4
            for k in range(n):
                v = struct.unpack_from('<I', d, 16 + 4 * k)[0]
                struct.pack_into('<I', d, 16 + 4 * k, pos_map[v])
            v = struct.unpack_from('<I', d, 12)[0]
            struct.pack_into('<I', d, 12, pos_map[v])
    data, _ = serialize(recs)
    for k in forbid:
        for enc in ('utf-16-le', 'cp932', 'latin1'):
            try:
                assert k.encode(enc) not in data, '前のお客様の情報が残っている: %s' % k
            except UnicodeEncodeError:
                pass
    streams = [('Workbook', data)] + other
    write_cfb(dst, streams, clsid)


def main():
    cfg = json.load(open(sys.argv[1], encoding='utf-8'))
    key = lambda s: tuple(int(x) for x in s.split(','))
    patch(cfg['src'], cfg['dst'],
          {key(k): v for k, v in cfg['strings'].items()},
          {key(k): v for k, v in cfg['numbers'].items()},
          {key(k): v for k, v in cfg['formulas'].items()},
          cfg.get('blank_textboxes', []), cfg.get('forbid', []),
          [key(k) for k in cfg.get('clear', [])], cfg.get('textbox_delete', []))
    print('OK', cfg['dst'])


if __name__ == '__main__':
    main()
