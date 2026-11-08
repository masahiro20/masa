from engine.articles import Article
from engine.social import MAX_WEIGHT, URL_WEIGHT, _weight, compose, oauth1_header


def test_oauth1_signature_matches_documented_example():
    # Twitter の公式ドキュメント「Creating a signature」の例と同じ値で、同じ署名になること
    keys = {"X_API_KEY": "xvz1evFS4wEEPTGEFPHBog", "X_API_SECRET": "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
            "X_ACCESS_TOKEN": "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
            "X_ACCESS_TOKEN_SECRET": "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE"}
    header = oauth1_header("POST", "https://api.twitter.com/1.1/statuses/update.json", keys,
                           params={"status": "Hello Ladies + Gentlemen, a signed OAuth request!",
                                   "include_entities": "true"},
                           nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp="1318622958")
    assert 'oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"' in header


def test_compose_fits_and_keeps_url():
    url = "https://skill-compass.jp/articles/x/"
    a = Article(title="リスキリング補助金はいつもらえる？受け取りの仕組みとタイミングを整理", slug="x",
                audience="リスキリング補助金の受け取り時期が気になる方へ",
                description="リスキリング補助金の受け取り時期が気になる方へ。" + "補助は本人ではなく講座提供事業者に支給される仕組みです" * 5 + "。続き。",
                category="school", body="")
    text = compose(a, url, "#リスキリング")
    assert text.startswith(a.audience) and url in text and text.endswith("#リスキリング")
    assert _weight(text) - _weight(url) + URL_WEIGHT <= MAX_WEIGHT
    assert "続き" not in text  # 答えは最初の一文だけ
