import json
from unittest.mock import MagicMock, patch

from aymurai.llm_providers import LLMResponse
from aymurai.meta.api_interfaces import DocLabel
from aymurai.meta.entities import CanonicalEntities, CanonicalEntity, EntityAttributes
from aymurai.utils.entity_disambiguation.llm import (
    _collect_entity_context,
    _extract_snippet,
    llm_canonical_entities_inference,
    load_prompts_from_yaml,
)


class _FakeDocument:
    def __init__(self, document: str, labels: list[DocLabel]):
        self.document = document
        self.labels = labels


def _per_label(text: str, start: int, end: int) -> DocLabel:
    return DocLabel(
        text=text,
        start_char=start,
        end_char=end,
        attrs=EntityAttributes(aymurai_label="PER"),
    )


def test_load_prompts_from_yaml_returns_per_prompt_set():
    library = load_prompts_from_yaml()
    prompt = library.get("PER")
    assert prompt is not None
    assert "auditor experto" in prompt.system
    assert "{canonical_entities}" in prompt.user


def test_extract_snippet_expands_to_word_boundaries():
    text = "El acusado Juan Perez declaro ante el tribunal."
    label = _per_label("Perez", 16, 21)
    snippet = _extract_snippet(text, label, window_length=5)
    assert "Perez" in snippet
    assert not snippet.startswith(" ")


def test_extract_snippet_returns_full_text_when_window_is_none():
    text = "  El acusado  Juan Perez declaro.  "
    label = _per_label("Perez", 14, 19)
    snippet = _extract_snippet(text, label, window_length=None)
    assert snippet == "El acusado Juan Perez declaro."


def test_collect_entity_context_dedupes_and_orders_by_first_appearance():
    doc = _FakeDocument(
        document="Juan Perez fue citado. Luego Juan Perez declaro.",
        labels=[
            _per_label("Juan Perez", 0, 10),
            _per_label("Juan Perez", 29, 39),
        ],
    )
    snippets = _collect_entity_context(
        [doc], "PER", ["Juan Perez"], window_length=5, max_context_snippets=5
    )
    assert len(snippets) == 2
    assert snippets[0] != snippets[1]


def test_llm_canonical_entities_inference_returns_none_when_batch_too_large(monkeypatch):
    entity = CanonicalEntity(
        aymurai_label="PER", canonical_text="Juan Perez", aliases=["Juan Perez"]
    )
    doc = _FakeDocument(document="Juan Perez fue citado.", labels=[_per_label("Juan Perez", 0, 10)])

    with patch(
        "aymurai.utils.entity_disambiguation.llm._get_model_tokens",
        return_value=999_999,
    ):
        result = llm_canonical_entities_inference(
            paragraphs=[doc],
            canonical_entities_pre_cluster=[entity],
            system_prompt="sys",
            user_prompt_template="{canonical_entities}",
            model="phi4:14b",
            tokenizer_model="microsoft/phi-4",
            target_label="PER",
            model_context=100,
            decompose_by=None,
        )

    assert result is None


def test_llm_canonical_entities_inference_parses_provider_response():
    entity = CanonicalEntity(
        aymurai_label="PER", canonical_text="Juan Perez", aliases=["Juan Perez"]
    )
    doc = _FakeDocument(document="Juan Perez fue citado.", labels=[_per_label("Juan Perez", 0, 10)])

    fake_payload = json.dumps(
        {
            "canonical_entities": [
                {
                    "aymurai_label": "PER",
                    "canonical_text": "PEREZ, JUAN",
                    "aliases": ["Juan Perez"],
                    "attributes": {"role": "Testigo"},
                }
            ]
        }
    )

    with patch(
        "aymurai.utils.entity_disambiguation.llm._get_model_tokens",
        return_value=10,
    ), patch(
        "aymurai.utils.entity_disambiguation.llm.OllamaLLMProvider"
    ) as mock_provider_cls:
        mock_provider = MagicMock()
        mock_provider.generate.return_value = LLMResponse(text=fake_payload)
        mock_provider_cls.return_value = mock_provider

        result = llm_canonical_entities_inference(
            paragraphs=[doc],
            canonical_entities_pre_cluster=[entity],
            system_prompt="sys",
            user_prompt_template="{canonical_entities}",
            model="phi4:14b",
            tokenizer_model="microsoft/phi-4",
            target_label="PER",
            model_context=9500,
            decompose_by=1,
        )

    assert len(result) == 1
    assert result[0].canonical_text == "PEREZ, JUAN"
    assert result[0].attributes.get("role") == "Testigo"
    mock_provider.generate.assert_called_once()
    _, kwargs = mock_provider.generate.call_args
    assert kwargs["options"]["temperature"] == 0
    assert kwargs["format"] == CanonicalEntities.model_json_schema()
