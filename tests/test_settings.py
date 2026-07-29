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


def test_disambiguation_llm_settings_have_expected_defaults(monkeypatch):
    for var in (
        "MODEL",
        "MODEL_CONTEXT",
        "TEMPERATURE",
        "CONTEXT_WINDOW_LENGTH",
        "TOKEN_LIMIT_FRAC",
        "TOKENIZER_MODEL",
        "DECOMPOSE_BY",
    ):
        monkeypatch.delenv(var, raising=False)

    fresh = Settings()
    assert fresh.MODEL == "phi4:14b"
    assert fresh.MODEL_CONTEXT == 9500
    assert fresh.TEMPERATURE == 0.0
    assert fresh.CONTEXT_WINDOW_LENGTH == 120
    assert fresh.TOKEN_LIMIT_FRAC == pytest.approx(2 / 3)
    assert fresh.TOKENIZER_MODEL == "microsoft/phi-4"
    assert fresh.DECOMPOSE_BY is None
