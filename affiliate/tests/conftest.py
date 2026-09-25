import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.articles import Article  # noqa: E402
from engine.config import load_config  # noqa: E402


@pytest.fixture
def cfg():
    return load_config()


def make_body(topic: str = "スクール選び", sections: int = 7, para: str | None = None) -> str:
    para = para or (
        f"{topic}では、学習目的・予算・学習時間の3点を先に決めておくと比較がしやすくなります。"
        "公式サイトの料金表やカリキュラムを確認し、自分の目的に合うかを一つずつ照らし合わせましょう。"
    )
    parts = [f"{topic}の結論を先にまとめます。目的に合わせて選ぶことが最も大切です。", ""]
    for i in range(sections):
        parts += [f"## 見出し{i + 1}：{topic}のポイント{i + 1}", ""] + [para * 4, ""] * 2
    parts += ["{{aff:school-general}}", "", "## よくある質問", "", "### 質問1", "", para]
    return "\n".join(parts)


@pytest.fixture
def good_article():
    return Article(
        title="社会人向けプログラミングスクールの選び方と比較のポイント",
        slug="programming-school-how-to-choose",
        description="社会人がプログラミングスクールを選ぶときに確認したい、目的・料金・サポート体制などの比較ポイントを、公開情報をもとにわかりやすく整理しました。",
        category="school",
        body=make_body(),
        tags=["プログラミングスクール", "社会人"],
        keyword="プログラミングスクール 選び方 社会人",
        programs=["school-general"],
        sources=[{"title": "A", "url": "https://example.com/a"}, {"title": "B", "url": "https://example.org/b"}],
        published="2026-09-01",
        updated="2026-09-01",
    )
