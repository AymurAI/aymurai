import pytest
from pydantic_core import ValidationError

from aymurai.settings import (
    DEFAULT_DISAMBIGUATION_LABEL_POLICIES,
    DEFAULT_RENDER_POLICY,
    Settings,
)


def test_anonymization_policy_defaults_are_used_when_env_vars_are_absent(monkeypatch):
    monkeypatch.delenv("DISAMBIGUATION_LABEL_POLICIES", raising=False)
    monkeypatch.delenv("RENDER_POLICY", raising=False)

    settings = Settings()

    assert (
        settings.DISAMBIGUATION_LABEL_POLICIES == DEFAULT_DISAMBIGUATION_LABEL_POLICIES
    )
    assert settings.DISAMBIGUATION_LABEL_POLICIES["PER"] == {
        "disambiguation": "fuzzy",
        "anonymize": True,
        "use_subclass_when_available": True,
    }
    assert settings.DISAMBIGUATION_LABEL_POLICIES["DNI"] == {
        "disambiguation": "fuzzy",
        "anonymize": True,
        "use_subclass_when_available": False,
    }
    assert settings.RENDER_POLICY == DEFAULT_RENDER_POLICY


def test_anonymization_policy_env_vars_override_defaults(monkeypatch):
    label_policies = (
        '{"PER": {"disambiguation": "none", "anonymize": false, '
        '"use_subclass_when_available": false}}'
    )
    render_policy = '{"suffix_mode": "always", "suffix_threshold": 0}'
    monkeypatch.setenv("DISAMBIGUATION_LABEL_POLICIES", label_policies)
    monkeypatch.setenv("RENDER_POLICY", render_policy)

    settings = Settings()

    assert settings.DISAMBIGUATION_LABEL_POLICIES == {
        "PER": {
            "disambiguation": "none",
            "anonymize": False,
            "use_subclass_when_available": False,
        }
    }
    assert settings.RENDER_POLICY == {"suffix_mode": "always", "suffix_threshold": 0}


@pytest.mark.parametrize("env_name", ["DISAMBIGUATION_LABEL_POLICIES", "RENDER_POLICY"])
def test_malformed_anonymization_policy_env_vars_raise_validation_error(
    monkeypatch, env_name
):
    monkeypatch.delenv("DISAMBIGUATION_LABEL_POLICIES", raising=False)
    monkeypatch.delenv("RENDER_POLICY", raising=False)
    monkeypatch.setenv(env_name, "{")

    with pytest.raises(ValidationError):
        Settings()


def test_transcribe_base_url_defaults_to_none(monkeypatch):
    monkeypatch.delenv("TRANSCRIBE_BASE_URL", raising=False)
    from aymurai.settings import Settings

    assert Settings().TRANSCRIBE_BASE_URL is None


def test_transcribe_api_key_defaults_to_not_needed(monkeypatch):
    monkeypatch.delenv("TRANSCRIBE_API_KEY", raising=False)
    from aymurai.settings import Settings

    assert Settings().TRANSCRIBE_API_KEY == "not-needed"


def test_transcribe_base_url_reads_from_env(monkeypatch):
    monkeypatch.setenv("TRANSCRIBE_BASE_URL", "http://coro:8000/v1")
    from aymurai.settings import Settings

    assert Settings().TRANSCRIBE_BASE_URL == "http://coro:8000/v1"


def test_llm_provider_defaults_to_llamacpp(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)

    assert Settings().LLM_PROVIDER == "llamacpp"


def test_llm_provider_reads_from_env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama")

    assert Settings().LLM_PROVIDER == "ollama"


def test_llm_provider_rejects_unknown_value(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "vllm")

    with pytest.raises(ValidationError):
        Settings()


def test_llamacpp_base_url_defaults_to_none(monkeypatch):
    monkeypatch.delenv("LLAMACPP_BASE_URL", raising=False)

    assert Settings().LLAMACPP_BASE_URL is None


def test_llamacpp_base_url_reads_from_env(monkeypatch):
    monkeypatch.setenv("LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    assert Settings().LLAMACPP_BASE_URL == "http://llamacpp:8080/v1"


def test_llamacpp_api_key_defaults_to_not_needed(monkeypatch):
    monkeypatch.delenv("LLAMACPP_API_KEY", raising=False)

    assert Settings().LLAMACPP_API_KEY == "not-needed"


def test_llamacpp_default_model_defaults_to_llamacpp(monkeypatch):
    monkeypatch.delenv("LLAMACPP_DEFAULT_MODEL", raising=False)

    assert Settings().LLAMACPP_DEFAULT_MODEL == "llamacpp"


def test_llamacpp_default_model_reads_from_env(monkeypatch):
    monkeypatch.setenv("LLAMACPP_DEFAULT_MODEL", "qwen3")

    assert Settings().LLAMACPP_DEFAULT_MODEL == "qwen3"


def test_ollama_host_defaults_to_localhost(monkeypatch):
    monkeypatch.delenv("OLLAMA_HOST", raising=False)

    assert Settings().OLLAMA_HOST == "http://localhost:11434"


def test_ollama_host_reads_from_env(monkeypatch):
    monkeypatch.setenv("OLLAMA_HOST", "http://ollama:11434")

    assert Settings().OLLAMA_HOST == "http://ollama:11434"


def test_ollama_default_model_defaults_to_gpt_oss(monkeypatch):
    monkeypatch.delenv("OLLAMA_DEFAULT_MODEL", raising=False)

    assert Settings().OLLAMA_DEFAULT_MODEL == "gpt-oss:20b"


def test_ollama_default_model_reads_from_env(monkeypatch):
    monkeypatch.setenv("OLLAMA_DEFAULT_MODEL", "llama3")

    assert Settings().OLLAMA_DEFAULT_MODEL == "llama3"


def test_llm_default_tokenizer_defaults_to_o200k_harmony(monkeypatch):
    monkeypatch.delenv("LLM_DEFAULT_TOKENIZER", raising=False)

    assert Settings().LLM_DEFAULT_TOKENIZER == "o200k_harmony"


def test_llm_default_tokenizer_reads_from_env(monkeypatch):
    monkeypatch.setenv("LLM_DEFAULT_TOKENIZER", "cl100k_base")

    assert Settings().LLM_DEFAULT_TOKENIZER == "cl100k_base"


def test_llm_default_num_ctx_defaults_to_16384(monkeypatch):
    monkeypatch.delenv("LLM_DEFAULT_NUM_CTX", raising=False)

    assert Settings().LLM_DEFAULT_NUM_CTX == 16_384


def test_llm_default_num_ctx_reads_from_env(monkeypatch):
    monkeypatch.setenv("LLM_DEFAULT_NUM_CTX", "8192")

    assert Settings().LLM_DEFAULT_NUM_CTX == 8192


def test_llm_default_num_predict_defaults_to_4096(monkeypatch):
    monkeypatch.delenv("LLM_DEFAULT_NUM_PREDICT", raising=False)

    assert Settings().LLM_DEFAULT_NUM_PREDICT == 4096


def test_llm_default_num_predict_reads_from_env(monkeypatch):
    monkeypatch.setenv("LLM_DEFAULT_NUM_PREDICT", "1024")

    assert Settings().LLM_DEFAULT_NUM_PREDICT == 1024
