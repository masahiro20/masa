# 請求書デスク

毎月の請求書を自動で作り、承認ボタンひとつでGmailから請求先へ送るアプリ。

- アプリ: https://claude.ai/artifact/Um2WD54fqrcyqVFQ78XGRm （claude.ai 上の非公開ページ）
- 毎月1日 9:00（JST）にルーティン「請求書デスク：毎月1日の請求書作成と承認のお知らせ」が
  その月の請求書を「承認待ち」で作り、スマホにプッシュ通知で知らせる。取引先へは送らない。
- アプリで内容を確認して「承認して送信」を押すと、PDFを添付してGmailから送信される（控えは自分にBCC）。

## ファイル

- `index.html` … アプリ画面（承認・請求先・発行者/メール設定・履歴）
- `invoice-core.js` … 金額計算とPDF生成（ブラウザ・Node共通）。PDFは和文標準フォント参照のため数KB。

## データ（アプリのデータベース）

- `settings/issuer` … 発行者情報、振込先、請求ルール、メール文面
- `clients/{id}` … 請求先（宛先、品目、金額）
- `invoices/{YYYY-MM}-{clientId}` … 月ごとの請求書。status: pending / sending / sent / skipped / error

## 更新方法

`index.html` / `invoice-core.js` を編集し、同じアーティファクトURLに再公開する。
