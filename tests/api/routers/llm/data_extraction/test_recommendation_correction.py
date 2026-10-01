import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

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


RECIPIENT = {"position": "Cargo A", "is_primary": True, "macro_sector": None}


def test_put_correction_changing_only_recipients_bumps_the_etag(
    extraction_client, seeded_catalogs
):
    # Recipients live in their own table: a correction that touches nothing
    # else must still move the recommendation's version, or `If-Match` stops
    # protecting the very edit it exists for.
    document_id = _extract(extraction_client, "Documento de corrección ocho.")
    validated = extraction_client.put(
        f"/llm/data-extraction/{document_id}/validate",
        json=_validate_payload(recipients=[{**RECIPIENT, "name": "Nombre original"}]),
    ).json()
    recommendation_id = validated["id"]
    recipient_id = validated["recipients"][0]["id"]
    stale_etag = _etag(validated)

    first = extraction_client.put(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=_validate_payload(
            recipients=[{**RECIPIENT, "name": "Nombre corregido", "id": recipient_id}]
        ),
        headers={"If-Match": stale_etag},
    )
    assert first.status_code == 200
    assert first.json()["updated_at"] is not None
    assert _etag(first.json()) != stale_etag

    # The grilla's "última edición" reads the same column.
    listed = extraction_client.get("/llm/data-extraction/recommendations").json()
    assert listed["items"][0]["updated_at"] == first.json()["updated_at"]

    second = extraction_client.put(
        f"/llm/data-extraction/recommendations/{recommendation_id}",
        json=_validate_payload(recipients=[{**RECIPIENT, "name": "Pisa al anterior"}]),
        headers={"If-Match": stale_etag},
    )
    assert second.status_code == 412


def test_put_corrections_in_quick_succession_get_distinct_etags(
    extraction_client, seeded_catalogs
):
    # No sleep on purpose: whole-second timestamps made two writes within the
    # same second share an etag, so the second one's stale etag still matched.
    validated = _validated_recommendation(
        extraction_client, "Documento de corrección nueve."
    )
    recommendation_id = validated["id"]
    url = f"/llm/data-extraction/recommendations/{recommendation_id}"

    first = extraction_client.put(
        url,
        json=_validate_payload(publishable_content="Uno."),
        headers={"If-Match": _etag(validated)},
    )
    assert first.status_code == 200
    second = extraction_client.put(
        url,
        json=_validate_payload(publishable_content="Dos."),
        headers={"If-Match": _etag(first.json())},
    )
    assert second.status_code == 200
    assert len({_etag(validated), _etag(first.json()), _etag(second.json())}) == 3

    replay = extraction_client.put(
        url,
        json=_validate_payload(publishable_content="Tres."),
        headers={"If-Match": _etag(first.json())},
    )
    assert replay.status_code == 412


@pytest.mark.parametrize(
    "spell",
    [
        lambda naive: naive.isoformat() + "Z",
        lambda naive: naive.isoformat() + "+00:00",
        lambda naive: (
            (naive - timedelta(hours=3))
            .replace(tzinfo=timezone(timedelta(hours=-3)))
            .isoformat()
        ),
    ],
    ids=["zulu", "utc-offset", "buenos-aires-offset"],
)
def test_put_correction_accepts_timezone_aware_spellings_of_the_etag(
    extraction_client, seeded_catalogs, spell
):
    # The server stores and serializes naive UTC; an aware spelling of the
    # same instant must match it, not compare unequal forever.
    validated = _validated_recommendation(
        extraction_client, "Documento de corrección diez."
    )
    naive = datetime.fromisoformat(_etag(validated))

    response = extraction_client.put(
        f"/llm/data-extraction/recommendations/{validated['id']}",
        json=_validate_payload(publishable_content="Con zona horaria."),
        headers={"If-Match": spell(naive)},
    )
    assert response.status_code == 200
