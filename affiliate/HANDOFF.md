# 引き継ぎ書（スキルコンパス）

最終更新：2026-11-14（クラウドの Claude Code セッションからローカルの作業へ引き継ぐために作成）

## 1. 目的と方針

- **目的は、アフィリエイト収益を上げること。** 運営者の目標は「3か月後（2027年2月ごろ）に月3万円以上」。
- 運営者は**確認と進捗の管理だけ**をする。それ以外の作業は、すべて Claude が自動で回す。許可は Claude に任されている。ただし、お金がかかること・アカウントの作成・外部への投稿は、先に運営者に確かめる。
- 運営者への報告は**日本語**で、短く、専門用語を避ける。
- サイト：https://skill-compass.jp （GitHub Pages）
- リポジトリ：masahiro20/masa の `affiliate/`

## 2. 今の数字（2026-11-14時点）

- 記事：138本（1日3本ずつ自動で増える）。書き直し済み（voice: 2）：45本
- Google（Search Console、10月末まで）：1日100〜140回表示、クリックは1日1〜3回、平均20位前後。週ごとの表示は約+45%で伸びている
- もしもアフィリエイト（11/14）：広告の表示204回、クリック1回（行き先確認のための操作）、**成果0件**
- 一番強いテーマ：**給付金・補助金**（「リスキリング 補助金 いつもらえる」2位、「教育訓練給付制度 必要書類」6位）
- 勝てる型：具体的な悩み・手続き・文章のままの質問、年代・学歴・状況で絞った語。広い語（「プログラミングスクール 料金」）は負けている

## 3. 自動で動いている仕組み

| 何が | いつ | どこで |
|---|---|---|
| 記事の執筆（1本ずつ） | 毎日 6:47・12:47・18:47 | Routine（trigger `trig_01JBNEhSEVomgCExyyTSDT1s`、セッション `session_01LX4muTtywWWzFfm1wb2QnS`） |
| 既存記事の書き直し（2本） | 毎日 22:07 | Routine（trigger `trig_01DGgNH2KkbTPmNHGWZqXnQ8`、セッション `session_01BqLhEU5hT2a5Z7oBLipq2B`） |
| 毎週の改善（新テーマ・CTR改善・内部リンク・ガイド点検） | 毎週月曜 10:17 | Routine（trigger `trig_01ACUD2dwGV86cQQfZskhxiS`、上と同じセッション）。手順は `GROWTH_PLAYBOOK.md` |
| Search Console のデータ取得 | 毎週月曜 4:23 | `.github/workflows/affiliate-gsc.yml`（**Secrets 未登録のため、まだ動かない**） |
| 公開 | push ごと | `claude/articles-**` ブランチを push → `affiliate-publish.yml` がテスト・品質チェック → main に取り込み → `affiliate-autopilot.yml` がビルドしてデプロイ、IndexNow 通知 |
| 運用レポート | 公開ごと | GitHub Issue #3「アフィリエイト運用レポート」（data/STATUS.md）。週ごとの検索の伸び・伸ばしどころ・最近の改善を表示 |

- Routine の trigger の prompt はその場で書き換えられないため、作り直すか、手順はリポジトリのファイル（`GROWTH_PLAYBOOK.md`、`engine guide` の出力）に書いて、そちらを直す。
- 手で `fire_trigger` すると、リポジトリのない新しいセッションで動いて空振りする（2026-11-10 に確認）。定期の起動は、決まったセッションで正しく動く。

## 4. よく使うコマンド（`affiliate/` で実行）

```bash
pip install -r requirements.txt
python -m pytest -q tests            # テスト（54件）
python -m engine check               # 全記事の品質チェック
python -m engine build               # public/ にサイトを生成
python -m engine status              # 運用レポート（data/STATUS.md）
python -m engine next --n 3          # 次に書くテーマ・既存記事・Search Consoleの質問
python -m engine ideas --n 20        # Search Console に出ている質問と、8〜40位の語
python -m engine rewrite-next --n 2  # 次に書き直す記事（伸ばしどころを優先）
python -m engine gsc-import <ZIP/CSV>       # Search Console のエクスポートを取り込む（ページ・クエリ・日付）
python -m engine add-keywords <json>        # テーマを在庫に足す
python -m engine set-ad <案件ID> <広告コード> [--keep-text]  # もしもの広告コードを programs.yaml に反映
python -m engine post-x --dry-run --slugs …  # X投稿の文面確認（X自動投稿は中止。キー未登録なので動かない）
```

## 5. 主なファイル

- `config/site.yaml`：サイト設定、カテゴリ（school / career / tools / learning / fukugyo）、**テーマ別ガイド**（`niche.guides`）、**無料ツール**（`niche.tools`）、品質基準
- `config/programs.yaml`：広告案件。`url` があれば提携済み。`hold: true` は記事に使わない保管用
- `content/articles/*.md`：記事（front matter に audience・programs・sources など）
- `engine/prompts.py`：執筆ルール（1〜30）。25〜29は質問に答える書き方、30は「サービス名＋評判」の記事の型
- `GROWTH_PLAYBOOK.md`：毎週の改善の手順書
- `data/`：keywords.yaml（テーマの在庫）、gsc_*.json（Search Console）、growth_log.md、STATUS.md
- `templates/tools/`：無料ツール（教育訓練給付金シミュレーター、IT職種診断）
- `promo/sns-posts.md`：SNS投稿の下書き（手動用）

## 6. 広告案件の状態

**提携済み（LIVE）**
- byTech（school-general）
- ユニゾンキャリア（career-it-agent）
- Kredo Online（school-kredo）
- キャリナビ（career-coaching）
- ConoHa WING（tools-rental-server）
- オンライン動画講座（learning-online-course）
- Claude Code研修（learning-ai-coding）
- メーカーズジョブ（career-maker-agent）
- 家族でスタートAI（learning-family-ai）
- 楽天の技術書（learning-books）

キャリナビと楽天の技術書以外は**バナーだけ**の広告で、本文中の文字のリンクにならない。

**未提携**
- school-kyufukin（給付金対象講座）
- school-webdesign
- side-crowdsourcing
- career-freelance
- tools-domain

未提携の案件の枠は、広告が入っている関連記事への「あわせて読みたい」になる。

**保管のみ（hold）**
- 工場求人、失業保険給付金サポート、FPの保険相談、ソウガク

## 7. 残っている作業（ここから）

1. **ユニゾンキャリアと byTech のテキスト広告コードを取る**：もしもの「提携中プロモーション」→「広告リンク作成」→「テキスト」。取れたら `python -m engine set-ad career-it-agent <コード> --keep-text` のように反映する。`--keep-text` はバナーをCTA用に残すときに付ける。今の url がバナー用なので、テキストのコードで url を置き換え、バナーは banner_url に移す形にする。反映したら `engine build` で、文中のリンクが出ることを確かめる。
2. **申込単価の高い案件への提携申請**：もしもで「プログラミングスクール」「リスキリング」「給付金」「転職エージェント」「IT転職」を検索する。給付金・リスキリング補助金の対象講座、IT・エンジニア専門の転職支援を優先する。承認されたら programs.yaml に案件を足し、サービス名の評判テーマ（「〇〇 評判」など）を在庫に入れる。
3. **Search Console の自動取得**：Google Cloud でサービスアカウントを作り、Search Console API を有効にして JSON キーを作る。Search Console にそのアカウントを「制限付き」で追加する。GitHub の Secrets に `GSC_SERVICE_ACCOUNT_JSON`、Variables に `GSC_SITE_URL` を登録する。最後に Actions の affiliate-gsc を手で1回実行する。**JSON キーの中身は会話に書き出さない。**
4. 11/16（月）の改善ルーチンの初めての本番の結果を確かめる。見るのは、`claude/articles-20261116-growth` が公開されたかと、growth_log.md の追記。
5. 在庫の先頭にある「サービス名＋評判」の6本が公開されたら、内容（口コミを作っていないか）と広告の位置を確かめる。6本は、ユニゾンキャリア 口コミ・未経験、メーカーズジョブ 評判、Kredo 評判、ConoHa WINGとエックスサーバーの比較、AI駆動開発協会 とは。
6. 運営者のひとこと（`site.yaml` の operator_person / operator_message / operator_photo）は空のまま。運営者から受け取れたら入れる。

## 8. 守ること

- 事実・数字・出典を作らない。口コミ・体験談・読者の声を作らない。
- 運営者のパスワード、銀行口座、個人情報、APIキーを会話に書き出さない。Secrets は GitHub に直接登録する。
- main へは PR を通して入れる（自動の記事ブランチ `claude/articles-*` を除く）。マージは、テスト（affiliate-ci の `test`）が通ってから。
- 「最大〇〇万円得」のような確かめられない訴求の広告や、読者層と合わない広告（お金・保険・工場求人など）は `hold: true` にして記事に使わない。
- 広告の行き先を確かめるときは、広告のリンクを押さない（クリックとして数えられる）。バナー画像や公式サイトのURLで確かめる。
- X の自動投稿は中止（運営者の判断。仕組みはキー未登録で眠っている）。
- コミットメッセージに Claude のモデル名を書かない。
