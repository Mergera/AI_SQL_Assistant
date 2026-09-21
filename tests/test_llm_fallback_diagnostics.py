"""Tests for diagnostics returned when an LLM request falls back."""

import app as app_module
import pytest
import services.sql_generator as sql_generator


class FakeLLMError(Exception):
    """Provider-like exception with the attributes exposed by LiteLLM."""

    def __init__(self, message, *, status_code=None, provider=None, model=None):
        super().__init__(message)
        self.status_code = status_code
        self.llm_provider = provider
        self.model = model


def _raise(error):
    raise error


def test_generate_sql_returns_diagnostics_when_llm_falls_back(monkeypatch):
    error = FakeLLMError(
        "secret-token should never reach the API response",
        status_code=429,
        provider="openai",
        model="gpt-4o-mini",
    )
    monkeypatch.setattr(sql_generator, "_has_api_key", lambda: True)
    monkeypatch.setattr(
        sql_generator,
        "_generate_with_llm",
        lambda _query: _raise(error),
    )
    monkeypatch.setattr(
        sql_generator._rule_gen,
        "generate",
        lambda _query: "SELECT * FROM customers;",
    )

    result = sql_generator.generate_sql("show all customers")

    assert result == {
        "sql": "SELECT * FROM customers;",
        "method": "rule-based",
        "warning": "LLM generation failed; the rule-based fallback was used.",
        "llm_error": {
            "code": "rate_limit",
            "message": "The LLM provider rate limit was exceeded. Try again later.",
            "type": "FakeLLMError",
            "status_code": 429,
            "provider": "openai",
            "model": "gpt-4o-mini",
        },
    }
    assert "secret-token" not in str(result)


def test_explain_sql_returns_diagnostics_when_llm_falls_back(monkeypatch):
    error = FakeLLMError(
        "invalid key",
        status_code=401,
        provider="gemini",
        model="gemini-2.5-flash",
    )
    monkeypatch.setattr(sql_generator, "_has_api_key", lambda: True)
    monkeypatch.setattr(
        sql_generator.litellm,
        "completion",
        lambda **_kwargs: _raise(error),
    )

    result = sql_generator.explain_sql("SELECT * FROM customers;")

    assert result["method"] == "rule-based"
    assert result["warning"] == (
        "LLM explanation failed; the rule-based fallback was used."
    )
    assert result["llm_error"] == {
        "code": "authentication_failed",
        "message": "Authentication with the LLM provider failed. Check the API key.",
        "type": "FakeLLMError",
        "status_code": 401,
        "provider": "gemini",
        "model": "gemini-2.5-flash",
    }


def test_expected_offline_fallback_does_not_return_a_warning(monkeypatch):
    monkeypatch.setattr(sql_generator, "_has_api_key", lambda: False)
    monkeypatch.setattr(
        sql_generator._rule_gen,
        "generate",
        lambda _query: "SELECT * FROM customers;",
    )

    result = sql_generator.generate_sql("show all customers")

    assert result == {
        "sql": "SELECT * FROM customers;",
        "method": "rule-based",
    }


def test_timeout_without_status_code_is_classified(monkeypatch):
    class ProviderTimeout(Exception):
        pass

    error = ProviderTimeout("request timed out")
    monkeypatch.setattr(sql_generator, "LLM_MODEL", "groq/llama-3.3-70b-versatile")

    diagnostics = sql_generator._llm_error_diagnostics(error)

    assert diagnostics == {
        "code": "timeout",
        "message": "The LLM provider timed out. Try again later.",
        "type": "ProviderTimeout",
        "status_code": None,
        "provider": "groq",
        "model": "groq/llama-3.3-70b-versatile",
    }


@pytest.mark.parametrize(
    ("status_code", "expected_code"),
    [
        (403, "permission_denied"),
        (404, "model_not_found"),
    ],
)
def test_http_status_codes_are_classified(status_code, expected_code):
    error = FakeLLMError("provider details", status_code=status_code)

    diagnostics = sql_generator._llm_error_diagnostics(error)

    assert diagnostics["code"] == expected_code


def test_generate_endpoint_returns_fallback_metadata(monkeypatch):
    error = FakeLLMError(
        "missing model",
        status_code=404,
        provider="gemini",
        model="gemini/missing-model",
    )
    monkeypatch.setattr(sql_generator, "_has_api_key", lambda: True)
    monkeypatch.setattr(
        sql_generator,
        "_generate_with_llm",
        lambda _query: _raise(error),
    )
    monkeypatch.setattr(
        sql_generator._rule_gen,
        "generate",
        lambda _query: "SELECT * FROM customers;",
    )

    response = app_module.app.test_client().post(
        "/generate",
        json={"query": "show all customers"},
    )

    assert response.status_code == 200
    assert response.get_json() == {
        "sql": "SELECT * FROM customers;",
        "method": "rule-based",
        "warning": "LLM generation failed; the rule-based fallback was used.",
        "llm_error": {
            "code": "model_not_found",
            "message": "The configured LLM model was not found. Check LLM_MODEL.",
            "type": "FakeLLMError",
            "status_code": 404,
            "provider": "gemini",
            "model": "gemini/missing-model",
        },
    }
