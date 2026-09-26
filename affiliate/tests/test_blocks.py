from engine.blocks import count_blocks, expand_links, extract_faq, render_blocks

BODY = """結論です。

:::summary
- わかること1
- わかること2
:::

:::merit
- 良い点
:::

:::demerit
- 注意点
:::

:::steps 申込の流れ
1. **登録**：フォームに入力
2. **面談**：オンラインで相談
:::

## よくある質問

### Q. 何社登録すべき？
**2〜3社**から始めるのが目安です。

### 費用はかかる？
求職者は無料です。
"""


def test_count_and_render():
    assert count_blocks(BODY) == 4
    out = render_blocks(BODY)
    assert 'class="box box-summary"' in out and "この記事でわかること" in out
    assert '<div class="box-pair">' in out  # メリット・デメリットは左右に並ぶ
    assert out.count('class="flow-num"') == 2 and ">2<" in out
    assert "申込の流れ" in out and ":::" not in out


def test_unknown_block_is_left_alone():
    assert render_blocks(":::foo\nx\n:::") == ":::foo\nx\n:::"


def test_links():
    targets = {"a-b": ("記事AB", "https://x/articles/a-b/")}
    out = expand_links("{{link:a-b}} と {{link:a-b|こちら}} と {{link:zz|消える}}", targets)
    assert '>記事AB</a>' in out and '>こちら</a>' in out and "消える" in out and "zz" not in out


def test_faq_extraction():
    faqs = extract_faq(BODY)
    assert faqs[0] == ("何社登録すべき？", "2〜3社から始めるのが目安です。")
    assert faqs[1][0] == "費用はかかる？"
