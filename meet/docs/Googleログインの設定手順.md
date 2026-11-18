# COMPASS Meet：Google ログインの設定手順（会社の Google 管理者向け）

COMPASS Meet では、**会社の Google アカウント（@limgroup.jp）でログインした人だけ**が担当者（主催者）になれます。そのために、Google 側に「ログインの窓口（OAuth クライアント）」を 1 つ作ってください。所要時間は 10〜15 分ほどです。

作業する人：リムグループの Google Workspace の管理者、または会社の Google Cloud を扱える方
費用：かかりません（Google のログインの窓口は無料です）

---

## 1. Google Cloud のプロジェクトを作る
1. 会社の Google アカウントで Google Cloud コンソール（console.cloud.google.com）を開きます。
2. 画面上のプロジェクト選択から「新しいプロジェクト」を選び、名前を「COMPASS Meet」にして作成します。
   組織（limgroup.jp）の下に作ってください。

## 2. 同意画面（ブランディング・対象）を設定する
左のメニューで「API とサービス」→「OAuth 同意画面」を開きます。新しい画面では「Google Auth Platform」と表示されます。

| 項目 | 入れる内容 |
|---|---|
| アプリ名 | COMPASS Meet |
| ユーザーサポートメール | 管理者のアドレス |
| 対象（ユーザーの種類） | **内部（Internal）** |
| 連絡先 | 管理者のアドレス |
| スコープ | 追加しなくて大丈夫です（openid・email・profile だけを使います） |

「内部」を選ぶと、limgroup.jp のアカウント以外は Google の時点でログインできなくなります。COMPASS Meet 側でも同じ確認をしているので、二重の守りになります。

## 3. ログインの窓口（OAuth クライアント）を作る
1. 「認証情報」（または「クライアント」）→「認証情報を作成」→「OAuth クライアント ID」を選びます。
2. 次のように入れます。

| 項目 | 入れる内容 |
|---|---|
| アプリケーションの種類 | ウェブ アプリケーション |
| 名前 | COMPASS Meet |
| 承認済みの JavaScript 生成元 | `https://compass-meet.vercel.app` |
| 承認済みのリダイレクト URI | `https://compass-meet.vercel.app/api/auth/google/callback` |

3. 作成すると、**クライアント ID** と **クライアント シークレット** が表示されます。

> クライアント シークレットは**パスワードと同じ扱い**です。メール・チャット・LINE には貼らず、次の手順 4 で Vercel に直接入れてください。

## 4. Vercel に設定する
Vercel のプロジェクト「compass-meet」を開き、「Settings」→「Environment Variables」で次を追加します。対象は Production です。値の種類は「Sensitive」を選びます。

| 名前 | 値 |
|---|---|
| `GOOGLE_CLIENT_ID` | 手順 3 のクライアント ID |
| `GOOGLE_CLIENT_SECRET` | 手順 3 のクライアント シークレット |
| `GOOGLE_ALLOWED_DOMAIN` | `limgroup.jp` |
| `GOOGLE_ADMIN_EMAILS` | 管理者にする人のアドレス（カンマ区切り。全員の記録を見られるようになります） |
| `PUBLIC_URL` | `https://compass-meet.vercel.app` |
| `DATA_KEY`、`SESSION_SECRET` | 保存データの暗号化とログインの署名に使う鍵。`node scripts/setup.js keys` で作ります（作業者にお任せください） |

設定したら、もう一度デプロイ（公開）すると反映されます。

## 5. 確かめ方
1. compass-meet.vercel.app を開き、「Google でログイン」を押します。
2. 会社のアカウントを選び、ログインできることを確かめます。
3. 個人の Gmail ではログインできないことを確かめます。「会社の Google アカウントでログインしてください」と表示されます。

---

## よくある質問
- **社員を一人ずつ登録する必要はありますか？** ありません。limgroup.jp のアカウントを持っている人は、誰でも担当者としてログインできます。人を絞りたい場合は、`GOOGLE_ALLOWED_EMAILS` に許可する人のアドレスを入れてください。
- **退職者はどうなりますか？** 会社の Google アカウントを止めると、COMPASS Meet にも新しくログインできなくなります。ログイン済みの人も、最長 12 時間で自動的にログアウトされます。
- **お客様もログインが必要ですか？** いいえ。お客様はこれまでどおり、リンクを開くだけで参加できます（担当者の許可が必要です）。
- **確認用（プレビュー）の URL でもログインできますか？** できません。Google に登録したアドレスでだけ動きます。試すときは本番のアドレスで行ってください。
