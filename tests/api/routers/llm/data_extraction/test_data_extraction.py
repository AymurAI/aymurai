import json

from aymurai.database.utils import text_to_uuid

from .conftest import FakeProvider, patched_provider


def _document(text: str = "Texto del documento.") -> dict:
    return {"document": [text], "document_id": str(text_to_uuid(text))}


def _raw_json(**overrides) -> str:
    payload = {
        "recommendation_number": "12/2022",
        "recommendation_date": "01 de enero de 2022",
        "recipients": [
            {
                "name": "Juan Perez",
                "position": "Director",
                "is_primary": True,
                "macro_sector": "GCBA",
            }
        ],
        "topic": "SALUD",
        "subtopic": "Hospitales",
        "personal_data": False,
        "publishable_content": "Resumen.",
    }
    payload.update(overrides)
    return json.dumps(payload)


def test_first_attempt_success(extraction_client, seeded_catalogs):
    provider = FakeProvider([_raw_json()])
    with patched_provider(provider):
        response = extraction_client.post(
            "/llm/data-extraction", json={"document": _document()}
        )

    assert response.status_code == 200
    body = response.json()
    assert body["topic"] == "SALUD"
    assert body["subtopic"] == "Hospitales"
    assert body["recipients"][0]["name"] == "Juan Perez"
    assert body["config"]["catalogs_hash"]
    assert len(provider.sent_system_prompts) == 1


def test_returns_cached_extraction_without_calling_llm(
    extraction_client, seeded_catalogs
):
    provider = FakeProvider([_raw_json()])
    doc = _document()
    with patched_provider(provider):
        first = extraction_client.post("/llm/data-extraction", json={"document": doc})
    assert first.status_code == 200

    provider2 = FakeProvider([])  # would raise IndexError if the LLM were called
    with patched_provider(provider2):
        second = extraction_client.post("/llm/data-extraction", json={"document": doc})

    assert second.status_code == 200
    assert second.json() == first.json()
    assert provider2.sent_system_prompts == []


def test_retries_and_recovers_on_invalid_subtopic_without_accumulating_prompt(
    extraction_client, seeded_catalogs
):
    provider = FakeProvider(
        [_raw_json(subtopic="Invalido"), _raw_json(subtopic="Hospitales")]
    )
    with patched_provider(provider):
        response = extraction_client.post(
            "/llm/data-extraction", json={"document": _document()}
        )

    assert response.status_code == 200
    body = response.json()
    assert body["subtopic"] == "Hospitales"
    assert body["config"]["options"]["attempts"] == 1
    assert len(provider.sent_system_prompts) == 2

    first_prompt, second_prompt = provider.sent_system_prompts
    assert "Corrección obligatoria" not in first_prompt
    assert second_prompt.count("Corrección obligatoria") == 1
    assert second_prompt.startswith(first_prompt)


def test_exhausts_retries_and_nulls_topic_subtopic(extraction_client, seeded_catalogs):
    provider = FakeProvider([_raw_json(subtopic="Invalido") for _ in range(3)])
    with patched_provider(provider):
        response = extraction_client.post(
            "/llm/data-extraction", json={"document": _document()}
        )

    assert response.status_code == 200
    body = response.json()
    assert body["topic"] is None
    assert body["subtopic"] is None
    assert body["recipients"][0]["name"] == "Juan Perez"

    # settings.DATA_EXTRACTION_MAX_RETRIES default is 2 -> 3 attempts total,
    # and no correction is built from a previous correction.
    assert len(provider.sent_system_prompts) == 3
    for prompt in provider.sent_system_prompts[1:]:
        assert prompt.count("Corrección obligatoria") == 1


def test_document_too_large_returns_422(extraction_client, seeded_catalogs):
    provider = FakeProvider([], n_ctx=10, tokens_per_call=1_000_000)
    with patched_provider(provider):
        response = extraction_client.post(
            "/llm/data-extraction", json={"document": _document()}
        )

    assert response.status_code == 422


def test_document_with_literal_braces_does_not_break_prompt_assembly(
    extraction_client, seeded_catalogs
):
    text = 'El documento dice "{destinatario}" y {"otro": "valor"} en su texto.'
    provider = FakeProvider([_raw_json()])
    with patched_provider(provider):
        response = extraction_client.post(
            "/llm/data-extraction", json={"document": _document(text)}
        )

    assert response.status_code == 200
