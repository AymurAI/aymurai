import json
import time
import uuid

from aymurai.database.utils import text_to_uuid

from .conftest import FakeProvider, patched_provider

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


def _validate_payload(**overrides) -> dict:
    payload = {
        "recommendation_number": None,
        "recommendation_date_text": None,
        "topic": None,
        "subtopic": None,
        "personal_data": None,
        "publishable_content": "Contenido.",
        "recipients": [],
    }
    payload.update(overrides)
    return payload


def _validated_recommendation(client, text: str) -> dict:
    """Extracts and validates a throwaway document, returning the full
    validation response body -- gives `id` plus `created_at`/`updated_at` for
    the `If-Match` header under test."""
    document_id = _extract(client, text)
    response = client.put(
        f"/llm/data-extraction/{document_id}/validate",
        json=_validate_payload(),
    )
    assert response.status_code == 200
    return response.json()


def _etag(body: dict) -> str:
    return body["updated_at"] or body["created_at"]


def test_put_correction_succeeds_with_matching_if_match(
    extraction_client, seeded_catalogs
):
    validated = _validated_recommendation(
        extraction_client, "Documento de corrección uno."
    )
    recommendation_id = validated["id"]

    response = extraction_client.put(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=_validate_payload(topic="SALUD", publishable_content="Corregido."),
        headers={"If-Match": _etag(validated)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["topic"] == "SALUD"
    assert body["publishable_content"] == "Corregido."
    assert body["source_text"] == "Documento de corrección uno."
    assert body["prediction"] != {}


def test_put_correction_stale_if_match_returns_412(extraction_client, seeded_catalogs):
    validated = _validated_recommendation(
        extraction_client, "Documento de corrección dos."
    )
    recommendation_id = validated["id"]

    # `Recommendation.created_at`/`updated_at` are both backed by SQLite's
    # `CURRENT_TIMESTAMP`, which only has whole-second resolution -- without
    # this sleep, `first`'s `updated_at` can land in the same second as
    # `validated`'s `created_at`, making the two timestamps compare equal and
    # this test flake (the "stale" etag wouldn't actually be stale).
    time.sleep(1.1)

    first = extraction_client.put(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=_validate_payload(publishable_content="Primera corrección."),
        headers={"If-Match": _etag(validated)},
    )
    assert first.status_code == 200

    # Reusing the original (now stale) etag after the row was already updated.
    stale = extraction_client.put(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=_validate_payload(publishable_content="Segunda corrección."),
        headers={"If-Match": _etag(validated)},
    )
    assert stale.status_code == 412


def test_put_correction_made_up_if_match_returns_412(
    extraction_client, seeded_catalogs
):
    validated = _validated_recommendation(
        extraction_client, "Documento de corrección tres."
    )
    recommendation_id = validated["id"]

    response = extraction_client.put(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=_validate_payload(),
        headers={"If-Match": "2020-01-01T00:00:00"},
    )
    assert response.status_code == 412


def test_put_correction_missing_if_match_returns_422(
    extraction_client, seeded_catalogs
):
    validated = _validated_recommendation(
        extraction_client, "Documento de corrección cuatro."
    )
    recommendation_id = validated["id"]

    response = extraction_client.put(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=_validate_payload(),
    )
    assert response.status_code == 422


def test_put_correction_malformed_if_match_returns_400(
    extraction_client, seeded_catalogs
):
    validated = _validated_recommendation(
        extraction_client, "Documento de corrección cinco."
    )
    recommendation_id = validated["id"]

    response = extraction_client.put(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=_validate_payload(),
        headers={"If-Match": "no-es-una-fecha"},
    )
    assert response.status_code == 400


def test_put_correction_missing_recommendation_returns_404(
    extraction_client, seeded_catalogs
):
    response = extraction_client.put(
        f"/llm/data-extraction/recommendations/{uuid.uuid4()}",
        json=_validate_payload(),
        headers={"If-Match": "2020-01-01T00:00:00"},
    )
    assert response.status_code == 404


def test_put_correction_preserves_seguimiento_fields(
    extraction_client, seeded_catalogs
):
    validated = _validated_recommendation(
        extraction_client, "Documento de corrección seis."
    )
    recommendation_id = validated["id"]

    seed_response = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=SEGUIMIENTO_FIELDS,
    )
    assert seed_response.status_code == 200
    seeded = seed_response.json()

    response = extraction_client.put(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=_validate_payload(topic="SALUD", publishable_content="Corregido."),
        headers={"If-Match": _etag(seeded)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["topic"] == "SALUD"
    for field, value in SEGUIMIENTO_FIELDS.items():
        assert body[field] == value


def test_put_correction_reconciles_recipients(
    extraction_client, seeded_catalogs, seeded_organigram_unit
):
    document_id = _extract(extraction_client, "Documento de corrección siete.")
    validate_response = extraction_client.put(
        f"/llm/data-extraction/{document_id}/validate",
        json=_validate_payload(
            recipients=[
                {
                    "name": "Se mantiene",
                    "position": "Cargo A",
                    "is_primary": True,
                    "macro_sector": None,
                },
                {
                    "name": "Se elimina",
                    "position": "Cargo B",
                    "is_primary": False,
                    "macro_sector": None,
                },
            ]
        ),
    )
    assert validate_response.status_code == 200
    validated = validate_response.json()
    recommendation_id = validated["id"]
    kept_id = validated["recipients"][0]["id"]
    assert validated["recipients"][0]["name"] == "Se mantiene"

    response = extraction_client.put(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=_validate_payload(
            recipients=[
                {
                    "id": kept_id,
                    "name": "Se mantiene",
                    "position": "Cargo A",
                    "is_primary": True,
                    "macro_sector": None,
                },
                {
                    "name": "Se agrega",
                    "position": "Cargo C",
                    "is_primary": False,
                    "macro_sector": None,
                },
            ]
        ),
        headers={"If-Match": _etag(validated)},
    )
    assert response.status_code == 200
    body = response.json()
    names = {r["name"] for r in body["recipients"]}
    ids = {r["id"] for r in body["recipients"]}
    assert names == {"Se mantiene", "Se agrega"}
    assert kept_id in ids
