import json
import uuid

from sqlmodel import Session

from aymurai.database.crud.llm_extraction import llm_extraction_get
from aymurai.database.utils import text_to_uuid

from .conftest import FakeProvider, patched_provider


def _document(text: str = "Texto del documento.", **overrides) -> dict:
    payload = {"document": [text], "document_id": str(text_to_uuid(text))}
    payload.update(overrides)
    return payload


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


def test_stores_the_uploaded_files_name_on_llm_extraction(
    extraction_client, extraction_engine, seeded_catalogs
):
    """`Document.file_name` (set by /misc/document-extract from the upload)
    must reach `llm_extraction.file_name` -- historically this was always
    None, since the router hardcoded it instead of reading the payload."""
    provider = FakeProvider([_raw_json()])
    doc = _document(file_name="Resolucion-1234-24.docx")
    with patched_provider(provider):
        response = extraction_client.post(
            "/llm/data-extraction", json={"document": doc}
        )

    assert response.status_code == 200
    document_id = response.json()["document_id"]

    with Session(extraction_engine) as session:
        record = llm_extraction_get(uuid.UUID(document_id), session)
        assert record.file_name == "Resolucion-1234-24.docx"


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


def test_exhausted_retries_survive_a_non_topic_violation(
    extraction_client, seeded_catalogs
):
    """ADR-0005: after retries are exhausted the response degrades to null
    fields, never a 5xx. A schema violation in a field OTHER than
    topic/subtopic must not escape the fallback as a 500."""
    # `publishable_content` is the wrong type -- a violation that nulling
    # topic/subtopic cannot repair.
    provider = FakeProvider(
        [_raw_json(subtopic="Invalido", publishable_content=12345) for _ in range(3)]
    )
    with patched_provider(provider):
        response = extraction_client.post(
            "/llm/data-extraction", json={"document": _document()}
        )

    assert response.status_code == 200
    body = response.json()
    assert body["topic"] is None
    assert body["subtopic"] is None
    assert body["publishable_content"] == ""


def test_exhausted_retries_survive_json_that_is_not_an_object(
    extraction_client, seeded_catalogs
):
    """`json.loads` succeeds on a JSON array, so the last parse can be a
    non-mapping. Spreading that into the repair dict would raise TypeError --
    which is not a ValidationError and would 500 straight through the
    fallback. The response must still degrade to null fields."""
    provider = FakeProvider(["[1, 2]" for _ in range(3)])
    with patched_provider(provider):
        response = extraction_client.post(
            "/llm/data-extraction", json={"document": _document()}
        )

    assert response.status_code == 200
    body = response.json()
    assert body["topic"] is None
    assert body["subtopic"] is None
    assert body["publishable_content"] == ""


def test_correction_prompt_shows_the_output_that_actually_failed(
    extraction_client, seeded_catalogs
):
    """The correction prompt must pair the newest error with the output that
    caused it. When an attempt fails to parse as JSON at all, the prompt must
    show that unparseable text -- not the previous attempt's output."""
    provider = FakeProvider(
        [
            _raw_json(subtopic="Invalido", publishable_content="PRIMERA"),
            "no soy json en absoluto",
            _raw_json(),
        ]
    )
    with patched_provider(provider):
        response = extraction_client.post(
            "/llm/data-extraction", json={"document": _document()}
        )

    assert response.status_code == 200
    third_prompt = provider.sent_system_prompts[2]
    assert "no soy json en absoluto" in third_prompt
    assert "PRIMERA" not in third_prompt
