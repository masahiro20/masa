# 月次請求書の自動送信

毎月1日 9:00（JST）に GitHub Actions が請求書PDFを作成し、Gmail から取引先へ送信します。

## 初回セットアップ

1. **Gmailのアプリパスワードを発行**
   Googleアカウント → セキュリティ → 2段階認証をオン → 「アプリパスワード」で16桁のパスワードを作成。
2. **GitHub Secrets を登録**（リポジトリの Settings → Secrets and variables → Actions → New repository secret）
   | 名前 | 中身 |
   |---|---|
   | `GMAIL_ADDRESS` | 送信に使うGmailアドレス |
   | `GMAIL_APP_PASSWORD` | 1で作ったアプリパスワード |
   | `INVOICE_CONFIG` | `config.example.yaml` を自分の情報に書き換えたもの（YAML丸ごと） |
3. **テスト送信**
   Actions タブ → 「月次請求書の送信」→ Run workflow → `test` を選んで実行。
   2通とも自分のGmailに届くので、中身を確認する。

以降は毎月1日に自動で本番送信されます（控えは自分にBCC）。

## よくある変更

- 金額・宛先・振込先を変える → Secret `INVOICE_CONFIG` を更新
- 前月分か当月分か → `billing_month`（初期値: 前月分）
- 支払期限 → `due`（初期値: 当月末）
- 送信日時 → `.github/workflows/monthly-invoice.yml` の `cron`（UTC表記）

## ローカルで試す

```sh
pip install -r invoice/requirements.txt
python invoice/generate.py --config invoice/config.example.yaml   # out/ にPDFができる
```

## 注意

- 公開リポジトリでは、60日間コミットがないと GitHub がスケジュール実行を自動停止します。
  非公開リポジトリに移すのが確実です。
