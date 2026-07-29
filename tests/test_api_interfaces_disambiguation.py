import pytest
from pydantic import ValidationError

from aymurai.meta.api_interfaces import LabelPolicy, PromptLibrary, PromptSet


def test_label_policy_accepts_llm_disambiguation_value():
    policy = LabelPolicy(disambiguation="llm")
    assert policy.disambiguation == "llm"


def test_label_policy_rejects_unknown_disambiguation_value():
    with pytest.raises(ValidationError):
        LabelPolicy(disambiguation="not-a-real-mode")


def test_prompt_library_defaults_to_empty():
    library = PromptLibrary()
    assert library.as_dict == {}
    assert library.get("PER") is None


def test_prompt_library_indexes_prompt_sets_by_label():
    library = PromptLibrary(
        root=[PromptSet(label="PER", system="sys", user="usr")]
    )
    prompt = library.get("PER")
    assert prompt is not None
    assert prompt.system == "sys"
    assert prompt.user == "usr"
