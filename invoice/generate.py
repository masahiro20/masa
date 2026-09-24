"""月次請求書の自動作成・Gmail送信スクリプト。

使い方:
  python invoice/generate.py --config invoice/config.example.yaml            # PDFを作るだけ（送信しない）
  python invoice/generate.py --config ... --send --test-to you@example.com   # 全通を自分宛てにテスト送信
  python invoice/generate.py --send                                          # 本番送信（設定は環境変数 INVOICE_CONFIG）

送信には環境変数 GMAIL_ADDRESS / GMAIL_APP_PASSWORD（Googleのアプリパスワード）が必要。
"""

import argparse
import calendar
import datetime as dt
import os
import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path

import yaml
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

JST = dt.timezone(dt.timedelta(hours=9))
FONT = "HeiseiKakuGo-W5"
pdfmetrics.registerFont(UnicodeCIDFont(FONT))


def yen(n):
    return f"{n:,}"


def month_end(year, month):
    return dt.date(year, month, calendar.monthrange(year, month)[1])


def add_months(year, month, delta):
    m = year * 12 + (month - 1) + delta
    return m // 12, m % 12 + 1


def load_config(path):
    if path:
        return yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    raw = os.environ.get("INVOICE_CONFIG")
    if not raw:
        sys.exit("設定がありません: --config を指定するか、環境変数 INVOICE_CONFIG を設定してください")
    return yaml.safe_load(raw)


def resolve_dates(cfg, issue_date, target):
    """請求対象月・請求日・支払期限を決める。"""
    if target:
        year, month = map(int, target.split("-"))
    elif cfg.get("billing_month", "previous") == "previous":
        year, month = add_months(issue_date.year, issue_date.month, -1)
    else:
        year, month = issue_date.year, issue_date.month

    due_rule = cfg.get("due", "end_of_month")
    offset = {"end_of_month": 0, "end_of_next_month": 1}[due_rule]
    due_date = month_end(*add_months(issue_date.year, issue_date.month, offset))
    return year, month, due_date


def compute(inv, cfg, fmt):
    rate = cfg.get("tax_rate", 0.10)
    items = []
    for it in inv["items"]:
        qty = it.get("quantity", 1)
        amount = qty * it["unit_price"]
        items.append({"name": it["name"].format(**fmt), "quantity": qty,
                      "unit_price": it["unit_price"], "amount": amount})
    gross = sum(i["amount"] for i in items)
    if cfg.get("prices_include_tax", False):
        total = gross
        tax = gross - int(gross / (1 + rate))
        subtotal = total - tax
    else:
        subtotal = gross
        tax = int(subtotal * rate)  # 端数切り捨て
        total = subtotal + tax
    return items, subtotal, tax, total


def build_pdf(path, cfg, inv, number, issue_date, due_date, items, subtotal, tax, total, fmt):
    iss = cfg["issuer"]
    s = lambda size, **kw: ParagraphStyle("s", fontName=FONT, fontSize=size, leading=size * 1.5, **kw)

    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                            topMargin=18 * mm, bottomMargin=18 * mm,
                            title=f"請求書 {number}", author=iss["name"])
    story = [Paragraph("請 求 書", s(22, alignment=1)), Spacer(1, 8 * mm)]

    client = Paragraph(
        f"<font size=14>{inv['client_name']} {inv.get('honorific', '御中')}</font><br/>"
        f"{inv.get('contact', '')}", s(10))
    meta = Paragraph(
        f"請求番号：{number}<br/>請求日：{issue_date:%Y年%m月%d日}", s(9, alignment=2))
    issuer_lines = [iss["name"], iss.get("postal", ""), iss.get("address", ""),
                    f"TEL：{iss['tel']}" if iss.get("tel") else "",
                    iss.get("email", ""),
                    f"登録番号：{iss['registration_number']}" if iss.get("registration_number") else ""]
    issuer = Paragraph("<br/>".join(l for l in issuer_lines if l), s(9, alignment=2))

    head = Table([[client, meta], ["", issuer]], colWidths=[100 * mm, 70 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                              ("LINEBELOW", (0, 0), (0, 0), 0.8, colors.black)]))
    story += [head, Spacer(1, 6 * mm)]

    story.append(Paragraph(f"件名：{inv.get('subject', '').format(**fmt)}", s(10)))
    story.append(Paragraph("下記のとおりご請求申し上げます。", s(10)))
    story.append(Spacer(1, 3 * mm))

    total_box = Table([["ご請求金額（税込）", f"¥{yen(total)}-"], ["お支払期限", f"{due_date:%Y年%m月%d日}"]],
                      colWidths=[45 * mm, 55 * mm])
    total_box.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), FONT, 11), ("FONT", (1, 0), (1, 0), FONT, 16),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef1f5")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#999999")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    total_box.hAlign = "LEFT"
    story += [total_box, Spacer(1, 7 * mm)]

    rows = [["品目", "数量", "単価", "金額"]]
    rows += [[Paragraph(i["name"], s(9)), yen(i["quantity"]), yen(i["unit_price"]), yen(i["amount"])] for i in items]
    n = len(rows)
    tax_label = f"消費税（{int(cfg.get('tax_rate', 0.10) * 100)}%）"
    rows += [["", "", "小計（税抜）", yen(subtotal)], ["", "", tax_label, yen(tax)], ["", "", "合計", yen(total)]]
    t = Table(rows, colWidths=[90 * mm, 20 * mm, 30 * mm, 30 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), FONT, 9),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2f3e52")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, n - 1), 0.5, colors.HexColor("#999999")),
        ("GRID", (2, n), (-1, -1), 0.5, colors.HexColor("#999999")),
        ("BACKGROUND", (2, n), (2, -1), colors.HexColor("#eef1f5")),
        ("FONT", (2, -1), (-1, -1), FONT, 10),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"), ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story += [t, Spacer(1, 8 * mm)]

    bank = iss.get("bank", "").strip().replace("\n", "<br/>")
    story.append(Paragraph("【お振込先】", s(10)))
    story.append(Paragraph(bank, s(10)))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph("※振込手数料は貴社にてご負担くださいますようお願いいたします。", s(8)))
    doc.build(story)


def send_mail(cfg, inv, pdf_path, fmt, test_to):
    sender = os.environ["GMAIL_ADDRESS"]
    msg = EmailMessage()
    msg["From"] = f"{cfg['issuer']['name']} <{sender}>"
    if test_to:
        msg["To"] = test_to
        msg["Subject"] = "[テスト] " + cfg["mail"]["subject"].format(**fmt)
    else:
        msg["To"] = ", ".join(inv["to"])
        if inv.get("cc"):
            msg["Cc"] = ", ".join(inv["cc"])
        if cfg["mail"].get("bcc_self", True):
            msg["Bcc"] = sender
        msg["Subject"] = cfg["mail"]["subject"].format(**fmt)
    msg.set_content(cfg["mail"]["body"].format(**fmt))
    msg.add_attachment(pdf_path.read_bytes(), maintype="application", subtype="pdf", filename=pdf_path.name)

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(sender, os.environ["GMAIL_APP_PASSWORD"])
        smtp.send_message(msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", help="設定YAMLのパス（省略時は環境変数 INVOICE_CONFIG）")
    ap.add_argument("--month", help="請求対象月 YYYY-MM（省略時は設定の billing_month に従う）")
    ap.add_argument("--issue-date", help="請求日 YYYY-MM-DD（省略時は今日・JST）")
    ap.add_argument("--out", default="out", help="PDF出力先")
    ap.add_argument("--send", action="store_true", help="Gmailで送信する")
    ap.add_argument("--test-to", help="全通をこのアドレスにだけ送る（テスト用）")
    args = ap.parse_args()

    cfg = load_config(args.config)
    issue_date = dt.date.fromisoformat(args.issue_date) if args.issue_date else dt.datetime.now(JST).date()
    year, month, due_date = resolve_dates(cfg, issue_date, args.month)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    for idx, inv in enumerate(cfg["invoices"], 1):
        number = f"{cfg.get('number_prefix', 'INV')}-{year}{month:02d}-{idx:02d}"
        fmt = {"year": year, "month": month}
        items, subtotal, tax, total = compute(inv, cfg, fmt)
        fmt.update(client_name=f"{inv['client_name']} {inv.get('honorific', '御中')}",
                   contact=inv.get("contact", ""), total=yen(total),
                   due_date=f"{due_date:%Y年%m月%d日}", issuer_name=cfg["issuer"]["name"])

        pdf_path = out / f"請求書_{number}_{inv['client_name']}.pdf"
        build_pdf(pdf_path, cfg, inv, number, issue_date, due_date, items, subtotal, tax, total, fmt)
        # 公開リポジトリのActionsログは誰でも見えるため、取引先名・金額はログに出さない
        print(f"{idx}通目: {number} を作成")

        if args.send:
            send_mail(cfg, inv, pdf_path, fmt, args.test_to)
            print(f"{idx}通目: {'テスト送信' if args.test_to else '送信'}完了")


if __name__ == "__main__":
    main()
