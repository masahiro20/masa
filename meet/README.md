# COMPASS Meet（meet/）

ホームランディックの住宅営業向けのオンライン商談ツールです。COMPASS の予定から使うことを想定しています。お客様はアカウント登録なしで、リンクを開くだけで参加できます。

- 担当者はログインして主催者になり、お客様は担当者の許可で入室します
- 映像と音声は端末どうしで直接（暗号化して）やりとりし、録画はしません
- 画面共有やホワイトボードの図面に、担当者とお客様の両方が書き込めます
- 担当者のメモ、決定事項、宿題を、打ち合わせ記録として保存します
- 文字起こしと AI 議事録の仕組みもありますが、初期状態は無効です（使うには承認と設定が必要）

## 資料
- [docs/最終報告.md](docs/最終報告.md)：今回の作業のまとめ、残っている課題、運用できるかどうかの評価
- [docs/セキュリティ.md](docs/セキュリティ.md)：対策と、残っているリスク
- [docs/仕組み.md](docs/仕組み.md)：構成、流れ、保存するもの、API、設定
- [docs/機能比較.md](docs/機能比較.md)：Zoom、Google Meet との比較

## 手元で動かす

```bash
cd meet
node scripts/setup.js staff nakatani "中谷 真弘"   # 社員アカウントを 1 件作る（出てきた 1 行を STAFF_ACCOUNTS に入れる）
STAFF_ACCOUNTS='[ ...上の 1 行... ]' INSECURE_COOKIE=1 npm start   # http://localhost:8080
```

依存パッケージはありません（Node.js 20 以上だけ）。手元で鍵を設定しない場合は、起動のたびに使い捨ての鍵を使うため、再起動すると保存した記録は読めなくなります。

## 本番（Vercel）に必要な設定
| 環境変数 | 作り方 |
|---|---|
| `DATA_KEY`、`SESSION_SECRET`（、`MEET_API_KEY`） | `node scripts/setup.js keys` |
| `GOOGLE_CLIENT_ID` など | 会社の Google アカウントでのログイン。手順は [docs/Googleログインの設定手順.md](docs/Googleログインの設定手順.md) |
| `STAFF_ACCOUNTS`（任意） | Google ログインを使わない場合だけ。`node scripts/setup.js staff <社員ID> <表示名> [admin]` で作る |
| `KV_REST_API_URL`、`KV_REST_API_TOKEN` | Vercel の Storage から Upstash を追加すると、自動で入る |
| TURN、文字起こし、AI | 「docs/仕組み.md」の 11 章を参照（どれも契約・承認のあとで設定する） |

本番で `DATA_KEY` と `SESSION_SECRET` が未設定のときは、API が動きません（安全のため）。

## 試験

```bash
npm test                       # API・Google ログイン・部品の試験（61 件）
node tests/e2e.js              # ブラウザ 3 台（Chromium・偽のカメラ）での通しの確認
E2E_MODE=vercel node tests/e2e.js   # Vercel の入口（api/handler.js）を通した形で確認
```
