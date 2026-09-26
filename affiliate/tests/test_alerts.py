from engine import cli


def test_alerts(cfg, tmp_path, monkeypatch):
    monkeypatch.setattr(cli, "ALERT_FILE", tmp_path / "ALERT.md")
    cli.write_alerts(cfg, {"errors": []}, 3, 5)
    assert not (tmp_path / "ALERT.md").exists()

    cli.write_alerts(cfg, {"errors": ["ANTHROPIC_API_KEY 未設定"]}, 0, 0)
    assert "APIキーが未設定" in (tmp_path / "ALERT.md").read_text()

    cli.write_alerts(cfg, {"errors": []}, 9, 11)
    assert "ASPの審査申請" in (tmp_path / "ALERT.md").read_text()

    cli.write_alerts(cfg, {"errors": []}, 11, 13)
    assert not (tmp_path / "ALERT.md").exists()
