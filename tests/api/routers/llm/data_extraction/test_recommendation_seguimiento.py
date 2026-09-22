import json
import uuid

from aymurai.database.utils import text_to_uuid

from .conftest import FakeProvider, patched_provider

# The six follow-up fields owned by this PATCH -- never touched by /validate,
# only readable through the export before this endpoint existed (issue #58).
SEGUIMIENTO_FIELDS = {
    "file_number": "EXP-1/2024",
    "recommendation_detail": "Detalle de seguimiento.",
    "recommendation_situation": "Respuesta",
    "status": "No solucionado",
    "approved_for_publication": True,
    "link": "https://example.org/doc",
}


def _document(text: str) -> dict:
    return {"document": [text], "document_id": str(text_to_uuid(text))}


def _extraction_payload(**overrides) -> str:
    payload = {
        "recommendation_number": "5/2024",
        "recommendation_date": "01 de enero de 2024",
        "recipients": [],
        "topic": "SALUD",
        "subtopic": "Hospitales",
        "personal_data": False,
        "publishable_content": "Resumen.",
    }
    payload.update(overrides)
    return json.dumps(payload)


def _extract(client, text: str) -> str:
    provider = FakeProvider([_extraction_payload()])
    with patched_provider(provider):
        response = client.post(
            "/llm/data-extraction", json={"document": _document(text)}
        )
    assert response.status_code == 200
    return response.json()["document_id"]


def _validated_recommendation_id(client, text: str) -> str:
    """Extracts and validates a throwaway document, returning the resulting
    recommendation's id -- the PATCH under test always needs an existing row."""
    document_id = _extract(client, text)
    response = client.put(
        f"/llm/data-extraction/{document_id}/validate",
        json={
            "recommendation_number": None,
            "recommendation_date_text": None,
            "topic": None,
            "subtopic": None,
            "personal_data": None,
            "publishable_content": "Contenido.",
            "recipients": [],
        },
    )
    assert response.status_code == 200
    return response.json()["id"]


def test_patch_updates_only_given_field_others_survive(
    extraction_client, seeded_catalogs
):
    recommendation_id = _validated_recommendation_id(
        extraction_client, "Documento de seguimiento uno."
    )

    seed_response = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=SEGUIMIENTO_FIELDS,
    )
    assert seed_response.status_code == 200
    for field, value in SEGUIMIENTO_FIELDS.items():
        assert seed_response.json()[field] == value

    response = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json={"status": "Solucionado"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "Solucionado"
    for field, value in SEGUIMIENTO_FIELDS.items():
        if field == "status":
            continue
        assert body[field] == value


def test_patch_null_clears_field_others_survive(extraction_client, seeded_catalogs):
    recommendation_id = _validated_recommendation_id(
        extraction_client, "Documento de seguimiento dos."
    )
    seed_response = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=SEGUIMIENTO_FIELDS,
    )
    assert seed_response.status_code == 200

    response = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json={"link": None},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["link"] is None
    for field, value in SEGUIMIENTO_FIELDS.items():
        if field == "link":
            continue
        assert body[field] == value


def test_patch_rejects_extraction_field(extraction_client, seeded_catalogs):
    recommendation_id = _validated_recommendation_id(
        extraction_client, "Documento de seguimiento tres."
    )

    response = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json={"topic": "SALUD"},
    )
    assert response.status_code == 422


def test_patch_missing_recommendation_returns_404(extraction_client, seeded_catalogs):
    response = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{uuid.uuid4()}",
        json={"status": "Solucionado"},
    )
    assert response.status_code == 404


def test_patch_response_includes_updated_at(extraction_client, seeded_catalogs):
    recommendation_id = _validated_recommendation_id(
        extraction_client, "Documento de seguimiento cuatro."
    )

    response = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json={"status": "Solucionado"},
    )
    assert response.status_code == 200
    assert response.json()["updated_at"] is not None
