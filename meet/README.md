# COMPASS 通話（meet/）

COMPASS のカレンダーから使うオンライン通話です。Google カレンダーと Meet の関係と同じく、
**予定ごとに通話リンクを発行し、そのリンクを開くだけで参加**できます。アプリのインストールは要りません。

## できること

- 通話リンクの発行（`https://<ドメイン>/r/abc-defg-hij` の形）。題名・日時・COMPASS の予定 ID を結びつけられる
- 入室前の確認画面（カメラ・マイクの確認、名前の入力）
- **待機室**：先に入っている人が「許可」するまで、後から来た人は入れない（お客様との打ち合わせ向け）
- 映像・音声、マイク／カメラの入切、**画面共有**（図面の細い線がつぶれないよう、精細さを優先して送る）
- 共有中の画面を大きく表示、参加者一覧、チャット、招待リンクのコピー
- Google カレンダーへの追加リンク、予定ファイル（.ics）、COMPASS の予定メモに貼る文のコピー
- スマートフォン（iPhone Safari・Android Chrome）対応

人数は少人数（既定 6 人まで）を想定しています。参加者どうしを直接つなぐ方式なので、
サーバーは映像を中継せず、映像・音声の中身はサーバーを通りません（通信は WebRTC の標準で暗号化）。

## 動かし方

```bash
cd meet
npm start            # http://localhost:8080
```

依存パッケージはありません（Node.js 20 以上だけ）。

### 設定（環境変数）

| 変数 | 意味 | 既定 |
|---|---|---|
| `PORT` | 待ち受けるポート | `8080` |
| `PUBLIC_URL` | 発行するリンクの頭（例 `https://meet.example.co.jp`） | 受けたリクエストのホスト名 |
| `MEET_API_KEY` | COMPASS 側から呼ぶときの鍵。ルームの削除にも使う | なし（本番では必ず設定） |
| `PUBLIC_CREATE` | `0` にすると、通話リンクの発行は鍵を持つ仕組みからだけになる | `1` |
| `ICE_SERVERS` | STUN/TURN の設定（JSON 配列） | Google の公開 STUN |
| `MAX_PEERS` | 1 つの通話の最大人数 | `6` |
| `ROOM_TTL_DAYS` | リンクの有効期間（日） | `30` |
| `DATA_FILE` | 発行したリンクを残すファイル（再起動してもリンクが切れない） | `meet/data/rooms.json` |

### 本番で必ず要るもの

1. **HTTPS**：ブラウザは HTTPS でないとカメラ・マイクを使わせません（localhost だけは例外）。
2. **TURN サーバー**：会社やマンションのネットワークによっては、STUN だけではつながりません。
   coturn を自前で立てるか、Cloudflare Calls / Twilio などの TURN を使い、`ICE_SERVERS` に入れます。

   ```bash
   ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.co.jp:3478","username":"u","credential":"p"}]'
   ```
3. **常に動き続けるサーバー**：SSE（つなぎっぱなしの通知）を使うので、Vercel などの関数型ではなく、
   Cloud Run（最小インスタンス 1・セッションアフィニティ有効）、Render、Fly.io、社内サーバーなどで 1 台動かします。
   ルームの状態はメモリにあるので、**台数は 1 台**にしてください。

## COMPASS とのつなぎ方（Google カレンダー × Meet と同じ形）

COMPASS の予定画面に「オンライン通話を追加」ボタンを付け、押したときに次の API を呼ぶだけです。

### 通話リンクの発行

```http
POST /api/rooms
Authorization: Bearer <MEET_API_KEY>
Content-Type: application/json

{
  "title": "山田様 間取り打ち合わせ",
  "start": "2026-11-20T10:00",
  "end": "2026-11-20T11:00",
  "eventRef": "compass:<予定ID>",
  "lobby": true
}
```

返ってくるもの：

```json
{
  "id": "vvc-uswy-kyv",
  "url": "https://meet.example.co.jp/r/vvc-uswy-kyv",
  "title": "山田様 間取り打ち合わせ",
  "start": "2026-11-20T10:00",
  "end": "2026-11-20T11:00",
  "eventRef": "compass:<予定ID>",
  "lobby": true,
  "expiresAt": "2026-12-17T13:35:00.000Z",
  "participants": 0
}
```

COMPASS 側は `url` を予定に保存し、予定の詳細に「通話に参加」ボタンとして出します。
お客様へのメッセージ（COMPASS のやりとり画面）にも同じ `url` を差し込みます。

### そのほかの API

| 呼び方 | 用途 |
|---|---|
| `GET /api/rooms/:id` | 題名・日時・いま何人入っているか（予定画面に「通話中 2 人」と出すなど） |
| `DELETE /api/rooms/:id`（鍵が要る） | 予定を消したときに通話リンクも無効にする |
| `GET /healthz` | 死活確認 |

### COMPASS 側に頼むこと（開発元への依頼メモ）

- 予定に「通話リンク」欄を 1 つ追加（いまは予定のメモ欄しかない）
- 予定の作成・編集画面に「オンライン通話を追加」ボタン → 上の API を呼んで欄に入れる
- 予定の詳細に「通話に参加」ボタン（リンクを開くだけ）
- 予定を消したら `DELETE /api/rooms/:id`

COMPASS の改修が済むまでは、はじめの画面で作ったリンクを「COMPASS 予定メモ用にコピー」で予定のメモ欄に貼れば、同じように使えます。

## テスト

```bash
npm test                 # サーバーの流れ（発行・待機室・許可・中継・退出）
node tests/e2e.js        # ブラウザ 2 台で実際に映像・音声・画面共有・チャットがつながるか
```

`tests/e2e.js` は Playwright と Chromium を使います（偽のカメラ映像で確認）。

## これからの候補

- 録画・文字起こし（COMPASS の録音・議事録につなぐ）
- 7 人以上の通話（SFU という中継サーバーを入れる。LiveKit など）
- 社員はログインして入る（主催者だけが許可できるようにする）
