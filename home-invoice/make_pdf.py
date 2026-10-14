"""請求書(.xls)を、LibreOfficeで1ページのPDFにする。Excelの印刷にできるだけ近づけた確認・提出用。

必要なもの: apt-get install -y libreoffice-calc fonts-ipafont-gothic
  - 「ＭＳ Ｐゴシック」は IPAPGothic に置き換えて描く(幅が近いフォント)。
  - 日付は日本の表記(2026/10/14)で出す。
  - LibreOfficeは列幅の計算がExcelと少し違い、右端が2ページ目へはみ出すことがある。
    その時だけ、PDF用の一時コピーの倍率を100%から2%ずつ下げて1ページに収める。
    元のExcelは一切変えない。使った倍率は表示する。
使い方: python3 -I make_pdf.py <in.xls> <out.pdf>
"""
import os
import shutil
import struct
import subprocess
import sys
import tempfile

import olefile
import pymupdf
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xls_patch as X

FONTS = '''<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <alias binding="same"><family>ＭＳ Ｐゴシック</family><prefer><family>IPAPGothic</family><family>IPAGothic</family></prefer></alias>
  <alias binding="same"><family>MS PGothic</family><prefer><family>IPAPGothic</family><family>IPAGothic</family></prefer></alias>
  <alias binding="same"><family>ＭＳ ゴシック</family><prefer><family>IPAGothic</family></prefer></alias>
</fontconfig>
'''


def with_scale(src, dst, scale):
    """印刷の倍率だけ変えたコピーを作る(サイズは変わらない)"""
    o = olefile.OleFileIO(src)
    wb = o.openstream('Workbook').read()
    other = [('/'.join(n), o.openstream(n).read()) for n in o.listdir() if n != ['Workbook']]
    clsid = uuid.UUID(o.root.clsid).bytes_le if o.root.clsid else b'\0' * 16
    o.close()
    recs = X.parse_records(wb)
    bofs = [i for i, r in enumerate(recs) if r[0] == X.BOF]
    for i in range(bofs[1], bofs[2]):
        if recs[i][0] == 0xA1:
            struct.pack_into('<H', recs[i][1], 2, scale)
    data, _ = X.serialize(recs)
    assert len(data) == len(wb)
    X.write_cfb(dst, [('Workbook', data)] + other, clsid)


def convert(xls, workdir):
    home = os.path.join(workdir, 'home')
    os.makedirs(os.path.join(home, '.config', 'fontconfig'), exist_ok=True)
    open(os.path.join(home, '.config', 'fontconfig', 'fonts.conf'), 'w', encoding='utf-8').write(FONTS)
    out = os.path.join(workdir, 'out')
    shutil.rmtree(out, ignore_errors=True)
    env = dict(os.environ, HOME=home, LC_ALL='ja_JP.UTF-8')
    subprocess.run(['soffice', '--headless', '--norestore', '-env:UserInstallation=file://' + os.path.join(workdir, 'profile'),
                    '--convert-to', 'pdf', '--outdir', out, xls], env=env, check=True, capture_output=True, timeout=240)
    return os.path.join(out, os.path.splitext(os.path.basename(xls))[0] + '.pdf')


def main():
    src, dst = sys.argv[1], sys.argv[2]
    with tempfile.TemporaryDirectory() as w:
        for scale in range(100, 80, -2):
            f = os.path.join(w, 'in.xls')
            if scale == 100:
                shutil.copy(src, f)
            else:
                with_scale(src, f, scale)
            pdf = convert(f, w)
            if len(pymupdf.open(pdf)) == 1:
                shutil.copy(pdf, dst)
                print('OK 1ページ 倍率%d%% -> %s' % (scale, dst))
                return
        raise SystemExit('1ページに収まらない')


if __name__ == '__main__':
    main()
