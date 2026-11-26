# 毎日のスクール追加ルーチンの手順書

毎日動く Claude Code の Routine（スクール追加ルーチン）が、この手順で「給付金・補助金が使えるITスクール一覧」に
公式ページで確かめたスクールを足す。1校足すと、`/tools/kyufukin-school/<id>/`（「〇〇 給付金」で検索する人向けのページ）が自動で1本増える。
人の確認は不要。結果は data/growth_log.md と運用レポートに残る。

## 0. 準備

```bash
git fetch origin main
git checkout -B claude/articles-$(TZ=Asia/Tokyo date +%Y%m%d)-schools origin/main
cd affiliate && pip install -q -r requirements.txt
```

ブランチ名は必ず `claude/articles-<日本時間YYYYMMDD>-schools`。push すると GitHub Actions がテストと品質チェックをして main に取り込み、公開する（PR は作らない）。

## 1. 今日確かめる候補を選ぶ（3件まで）

data/school_candidates.yaml から、次の順に3件まで選ぶ。
1. status が todo のもの
2. status が retry で、checked から7日以上たったもの
3. どちらもなければ、候補を新しく探して足す（下の「候補の探し方」）

### 候補の探し方（todo が足りないとき）
- 厚生労働省「教育訓練講座検索システム」 https://www.kyufu.mhlw.go.jp/kensaku/ で、
  プログラミング・Webデザイン・AI・データ分析などの IT 系の講座を出しているスクール
- 経済産業省「リスキリングを通じたキャリアアップ支援事業」の補助事業者の検索 https://careerup.reskilling.go.jp/worker/search/
- config/programs.yaml にある案件（ASPで提携している・申請中）のスクール
- 見つけたら、data/school_candidates.yaml に `status: todo` で足す（すでにあるものは足さない）

## 2. 公式ページで確かめる

候補ごとに、スクールの**公式サイト**（給付金・補助金・リスキリング・料金・よくある質問のページ）を開く。
口コミサイト・比較サイト・ASPの説明文は根拠にしない。開くのは1回の実行で15ページまで。

次のどちらかが**公式ページに書かれていれば**足す。
- 厚生労働省の教育訓練給付金（一般教育訓練・特定一般教育訓練・専門実践教育訓練）の対象
- 経済産業省「リスキリングを通じたキャリアアップ支援事業」の対象

足さないとき：
- 書かれていない・対象外と書かれている → `status: skipped` と `reason`
- 指定期間が切れている・新規受付を終えた → `status: skipped` と `reason`
- ページが開けない（403・503・名前解決できない・本文が読めない） → `status: retry` と `reason`

## 3. config/schools.yaml に足す

ファイル先頭のコメントの書き方どおりに、末尾へ足す。

```yaml
  - id: 英小文字とハイフン（例：win-school）。すでにある id・まとめページの slug（ai, programming, webdesign, reskilling, senmon）と重ねない
    short: 短い名前（ページのタイトル「〇〇の給付金・補助金」に使う）
    name: 正式な名前（コース名を添えてもよい）
    official: 公式サイトのURL
    fields: [programming, ai, webdesign, marketing, data のうち当てはまるもの]
    format: [online, school, abroad のうち公式ページで確かめたもの。わからなければ空]
    summary: どんなスクールかを1文（公式ページに書かれていることだけ）
    program: config/programs.yaml の案件の id（申込先がその制度の対象講座の相談・説明会のときだけ。なければ書かない）
    subsidies:
      - system: ippan / tokutei / senmon / reskilling
        course: 公式ページに書かれた対象講座名（受講料が書かれていれば添える）
        source: その記載がある公式ページのURL
        checked: '今日の日付 YYYY-MM-DD'
        note: 条件（在職者のみ・加入期間・期限など）を公式ページの記載どおりに短く
```

足したら、data/school_candidates.yaml のその候補を `status: added` にし、`checked` を今日にする。
config/site.yaml の kyufukin-school の `updated` を今日の日付にする。

## 4. 確かめる

```bash
python -m pytest -q tests && python -m engine check && python -m engine build
```

`engine check` は schools.yaml の抜け（出典URL・確認日・hold の案件など）を止める。通らなければ直す。

## 5. 記録して push

data/growth_log.md の末尾に1行足す（運用レポートに出る）。

```
- 2026-11-27: スクール追加 2校（Winスクール、KENスクール）。見送り1校（〇〇：理由）
```

足したスクールが0校でも、候補の status を更新したなら push する。

```bash
git add -A && git commit -m "schools: <日付> スクール追加" && git push -u origin HEAD
```

## してはいけないこと

- 公式ページに書かれていないことを書く（口コミ・推測・ほかのサイトの情報）
- 制度の対象と確かめられないスクールを足す
- engine/ のコード、テンプレート、ワークフローを変える（気づいた改善案は growth_log に「提案：」として書く）
- 記事（content/articles）や広告（programs.yaml）を変える
