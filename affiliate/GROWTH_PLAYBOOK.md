# 毎週の改善ルーチンの手順書

毎週月曜に動く Claude Code の Routine（改善ルーチン）が、この手順で「表示回数・クリック率・収益」を伸ばす作業を行う。
記事の執筆（1日3本）と書き直し（毎晩2本）は別のルーチンが行うので、ここでは**それ以外の伸ばす作業**だけをする。
人の確認は不要。結果は data/growth_log.md と運用レポート（GitHub の Issue「アフィリエイト運用レポート」）に残る。

## 0. 準備

```bash
git fetch origin main
git checkout -B claude/articles-$(TZ=Asia/Tokyo date +%Y%m%d)-growth origin/main
cd affiliate && pip install -q -r requirements.txt
```

ブランチ名は必ず `claude/articles-<日本時間YYYYMMDD>-growth`。push すると GitHub Actions がテストと品質チェックをして main に取り込み、公開する（PR は作らない）。

## 1. 状況をつかむ

```bash
python -m engine status          # 「検索での伸び」（週ごとの表示・クリック・CTR・順位）
python -m engine ideas --n 20    # Search Console に出ている質問と、8〜40位の語
python -m engine next --n 3      # 在庫と既存記事の一覧（existing_articles）
```

data/gsc_pages.json（ページ別）と data/gsc_queries.json（検索語別）も読む。`imported` の日付が古い（14日以上前）なら、施策B・Cは数字が古い前提で控えめにする。

## 2. 施策A：勝てる型の新テーマを在庫に足す（8〜12件）

このサイトが勝てているのは「具体的な悩み・手続き・文章のままの質問」と「年代・学歴・状況を絞った語」。広い語（例：「プログラミングスクール 料金」）は狙わない。

1. 候補は、`ideas` の questions / near_miss と、上位に出ている記事の周辺の語から作る。
2. 各候補を Google サジェストで確かめる：
   `python -m engine suggest "<語1>" "<語2>" …`（curl は自動承認で止まることがあるので、このコマンドを使う）
   サジェストに出た言い回しを優先し、出ない語は boost を付けない。
3. `next` の existing_articles と検索意図が重なるものは除く（同じ悩みに2記事目を作らない）。
4. program は、config/programs.yaml で url があり `hold: true` でない案件から、内容に合うものを選ぶ。
5. JSON（keyword, intent, category, program, "boost": 1.5, "source": "google-suggest"）にして `python -m engine add-keywords <file>`。
6. **提携済みの案件のサービス名の語（最優先）**：config/programs.yaml で url があり hold でない案件ごとに、
   「<サービス名> 評判／口コミ／やめとけ／怪しい／未経験／比較」をサジェストで確かめ、まだ記事がない語を1〜3件足す
   （intent は transactional、boost は 3.0）。サービス名で検索する人は申込に最も近く、新しいサイトでも上位を取りやすい。
   書き方は執筆ルール30（口コミは作らず、公式・公的な情報で確かめる）に従う。

## 3. 施策B：検索結果でクリックされやすくする（2本まで）

data/gsc_pages.json から、次をすべて満たす記事を表示回数の多い順に選ぶ。
- 平均掲載順位が10位以内で、表示回数が30回以上
- CTR が順位の目安より低い（目安：1〜3位 10%、4〜6位 5%、7〜10位 2.5%）
- front matter の updated が21日以上前

選んだ記事は、**title と description だけ**を直す（本文・事実・数字・出典・広告は変えない）。
- title：主キーワードは前半に残し、答えの手がかり（数字・条件・結論）か誰向けかを足す。全角32字前後。
- description：audience の一文で始め、次に検索の答えを数字や条件つきで1文。50〜160字。
- data/gsc_queries.json で、その記事に来ていそうな検索語の言い回しを title に入れる。
- updated は今日の日付にする。

## 4. 施策C：伸びている記事へ内部リンクを集める（3本まで）

gsc_pages.json で表示回数が多い記事（上位10本）のうち、内部リンクが少ないものを選ぶ。
関連する既存記事の本文の自然な位置に、`{{link:slug|文言}}` を1本ずつ足す（1つの記事に足すのは1本まで、同じリンク先を重複させない）。
文言は、リンク先の記事が答える問い（例：「教育訓練給付金がいつ振り込まれるか」）にする。

## 5. 施策D：テーマ別ガイドの点検

`python -m engine build` のあと、次のコードで、どのガイドにも入っていない記事・「あわせて読みたい」に回った記事を確かめる。

```bash
python -c "from engine.site import build_guides; from engine.articles import load_articles; from engine.config import load_config; gs, m = build_guides(load_articles(), load_config().niche['guides']); [print(g['slug'], [a.slug for a in g['others']]) for g in gs]; print('none', [a.slug for a in load_articles() if a.slug not in m])"
```

明らかに入るべきガイドがあるのに外れている記事があれば、config/site.yaml の guides の match / steps を調整する。新しいガイドは作らない。

## 5.5 施策E：給付金・補助金が使えるスクール一覧の点検

config/schools.yaml（/tools/kyufukin-school/ に表示）を点検する。
- `checked` が100日以上前の制度があれば、その `source`（公式ページ）を開いて、まだ「対象」と書かれているか確かめる。
  書かれていれば `checked` を今日の日付に、消えていれば、その制度（制度が1つもなくなればスクールごと）を消す。1回の実行で3校まで。
- config/programs.yaml に新しく広告が入った案件があり、そのスクールが一覧にあれば `program` に案件の id を入れる。
  申込先が対象講座でない案件（例：対象外のコースの広告）は入れない。
- 一覧を変えたら、config/site.yaml の kyufukin-school の `updated` を今日の日付にする。
- 公式ページに書かれていないこと（口コミサイト・比較サイトの情報）は載せない。
- **新しいスクールを3〜5校足す**（掲載校を増やすほど、「〇〇 給付金」で受けられるページが自動で増える）。
  - 候補：Winスクール、KENスクール、DMM WEBCAMP、Aidemy Premium、WEBCOACH、テックエリート、たのまな、Tech0、
    DIVE INTO CODE（専門実践の指定期間の更新を確かめる）、そのほか config/programs.yaml の案件のスクール
  - 公式ページ（給付金・補助金・リスキリング・料金のページ）を開き、「教育訓練給付金（一般・特定一般・専門実践）の対象」か
    「経済産業省 リスキリングを通じたキャリアアップ支援事業の対象」と書かれていれば、schools.yaml の書き方どおりに足す
    （id・short・name・official・fields・format・summary・subsidies の system・course・source・checked・note）。
  - 開けない、書かれていない、指定期間が切れている、新規受付を終えている場合は足さず、schools.yaml 先頭のコメントに理由を書く。
  - 公式ページを開くのは1回の実行で10ページまで。

## 5.6 施策F：毎月の「給付金・補助金の最新情報」（その月の最初の月曜だけ）

その月の最初の月曜の実行では、在庫に次のテーマを1件足す（intent は informational、category は school、program は school-kredo、
boost は 3.0、source は monthly-news）。
`教育訓練給付金 リスキリング補助金 最新情報 <YYYY>年<M>月`
執筆ルーチンが、厚生労働省・経済産業省の公式ページで確かめた制度の変更・延長・締切だけを書く。噂や予想は書かない。

## 6. 確かめる

```bash
python -m pytest -q tests && python -m engine check && python -m engine build
```

すべて通らなければ、直すか、その施策を取り消す。

## 7. 記録して push

data/growth_log.md の末尾に、施策ごとに1行ずつ足す（数字つき、運用レポートに表示される）。

```
- 2026-11-16: 新テーマ10件を追加（例：教育訓練給付金 退職後 いつまで）
- 2026-11-16: CTR改善 kyoiku-kunren-kyufukin-shinsei-nagare（7.7位・CTR1.6%）のタイトルと説明文
- 2026-11-16: 内部リンク3本（→ reskilling-hojokin-itsu-moraeru ほか）
```

```bash
git add -A && git commit -m "growth: <日付> 毎週の改善" && git push -u origin HEAD
```

## してはいけないこと

- 事実・数字・料金・日付・出典を変える、体験談や読者の声を作る
- 広告ショートコード（`{{aff:…}}`）を足す・消す、`hold: true` の案件を使う
- engine/ のコード、ワークフロー、テンプレートを変える（気づいた改善案は growth_log に「提案：」として書く）
- 新しいツール・ガイドページを作る（スクール一覧への追加・点検は施策Eの範囲で行ってよい）
- Web検索を何度も使う（サジェストの確認と、施策Eのスクールの公式ページの確認だけにする。利用枠を節約するため）
