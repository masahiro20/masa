import anthropic

from engine.llm import api_key_from_env, describe_error


def test_api_key_is_stripped(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "  sk-ant-abc123\n")
    assert api_key_from_env() == "sk-ant-abc123"
    monkeypatch.setenv("ANTHROPIC_API_KEY", " \n")
    assert api_key_from_env() is None


def test_describe_error_redacts_key():
    try:
        try:
            raise ValueError("Illegal header value b'sk-ant-api03-SECRET_value-1\\n'")
        except ValueError as inner:
            raise anthropic.APIConnectionError(request=None) from inner  # type: ignore[arg-type]
    except anthropic.APIConnectionError as e:
        text = describe_error(e)
    assert "SECRET" not in text
    assert "APIConnectionError" in text and "ValueError" in text
    assert "sk-ant-***" in describe_error(RuntimeError("key sk-ant-api03-XYZ leaked"))
