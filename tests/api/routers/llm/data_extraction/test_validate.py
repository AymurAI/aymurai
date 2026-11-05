import json
import uuid

from sqlmodel import Session, select

from aymurai.database.schema import OrganigramUnit, Topic
from aymurai.database.utils import text_to_uuid

from .conftest import FakeProvider, patched_provider


def _document(text: str) -> dict:
    return {"document": [text], "document_id": str(text_to_uuid(text))}


def _extraction_payload(**overrides) -> str:
    payload = {
        "recommendation_number": "5/2024",
        "recommendation_date": "01 de enero de 2024",
        "recipients": [
            {
                "name": "Juan Perez",
                "position": "Ministerio de Salud",
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


def _extract(client, text: str) -> str:
    provider = FakeProvider([_extraction_payload()])
    with patched_provider(provider):
        response = client.post(
            "/llm/data-extraction", json={"document": _document(text)}
        )
    assert response.status_code == 200
    return response.json()["document_id"]


def test_full_cycle_extract_validate_query(
    extraction_client, seeded_catalogs, seeded_organigram_unit
):
    document_id = _extract(extraction_client, "Documento de prueba de validación.")

    validate_payload = {
        "recommendation_number": "10/2024",
        "recommendation_date_text": "02 de febrero de 2024",
        "topic": "SALUD",
        "subtopic": "Hospitales",
        "personal_data": True,
        "publishable_content": "Contenido corregido por un humano.",
        "recipients": [
            {
                "name": "Juan Perez",
                "position": "Ministerio de Salud",
                "is_primary": True,
                "macro_sector": "GCBA",
                "unit_id": str(seeded_organigram_unit.id),
                "sector_id": str(seeded_organigram_unit.id),
            }
        ],
    }
    response = extraction_client.put(
        f"/llm/data-extraction/{document_id}/validate", json=validate_payload
    )
    assert response.status_code == 200
    body = response.json()
    assert body["recommendation_number"] == "10/2024"
    assert body["topic"] == "SALUD"
    assert body["subtopic"] == "Hospitales"
    assert body["personal_data"] is True
    assert body["recipients"][0]["unit_name"] == "Ministerio de Salud"
    assert body["recipients"][0]["sector_name"] == "Ministerio de Salud"
    recommendation_id = body["id"]

    detail = extraction_client.get(
        f"/llm/data-extraction/recommendations/{recommendation_id}"
    )
    assert detail.status_code == 200
    detail_body = detail.json()
    assert detail_body["publishable_content"] == "Contenido corregido por un humano."
    assert detail_body["source_text"] == "Documento de prueba de validación."
    assert (
        detail_body["prediction"]["recommendation_number"] == "5/2024"
    )  # verbatim LLM output


def test_multi_client_persistence(
    extraction_client, second_extraction_client, seeded_catalogs
):
    doc_a = _extract(extraction_client, "Documento del cliente A.")
    doc_b = _extract(second_extraction_client, "Documento del cliente B.")

    payload = {
        "recommendation_number": None,
        "recommendation_date_text": None,
        "topic": None,
        "subtopic": None,
        "personal_data": None,
        "publishable_content": "Cliente A.",
        "recipients": [],
    }
    resp_a = extraction_client.put(
        f"/llm/data-extraction/{doc_a}/validate", json=payload
    )
    assert resp_a.status_code == 200

    payload["publishable_content"] = "Cliente B."
    resp_b = second_extraction_client.put(
        f"/llm/data-extraction/{doc_b}/validate", json=payload
    )
    assert resp_b.status_code == 200

    listing = extraction_client.get("/llm/data-extraction/recommendations")
    assert listing.status_code == 200
    contents = {item["publishable_content"] for item in listing.json()["items"]}
    assert contents == {"Cliente A.", "Cliente B."}
    assert listing.json()["total"] == 2


def test_recommendations_filter_by_topic_and_search(
    extraction_client, seeded_catalogs, extraction_engine
):
    doc_1 = _extract(extraction_client, "Documento uno.")
    doc_2 = _extract(extraction_client, "Documento dos.")

    resp_1 = extraction_client.put(
        f"/llm/data-extraction/{doc_1}/validate",
        json={
            "recommendation_number": None,
            "recommendation_date_text": None,
            "topic": "SALUD",
            "subtopic": None,
            "personal_data": None,
            "publishable_content": "Sobre hospitales públicos.",
            "recipients": [],
        },
    )
    extraction_client.put(
        f"/llm/data-extraction/{doc_2}/validate",
        json={
            "recommendation_number": None,
            "recommendation_date_text": None,
            "topic": None,
            "subtopic": None,
            "personal_data": None,
            "publishable_content": "Sobre otro tema.",
            "recipients": [],
        },
    )
    recommendation_1_id = resp_1.json()["id"]

    with Session(extraction_engine) as session:
        salud_topic_id = (
            session.exec(select(Topic).where(Topic.name == "SALUD")).first().id
        )

    by_topic = extraction_client.get(
        "/llm/data-extraction/recommendations", params={"topic_id": str(salud_topic_id)}
    )
    assert by_topic.json()["total"] == 1
    assert by_topic.json()["items"][0]["id"] == recommendation_1_id

    by_search = extraction_client.get(
        "/llm/data-extraction/recommendations", params={"q": "hospitales"}
    )
    assert by_search.json()["total"] == 1
    assert by_search.json()["items"][0]["id"] == recommendation_1_id


def test_pagination(extraction_client, seeded_catalogs):
    for i in range(3):
        doc_id = _extract(extraction_client, f"Documento paginado {i}.")
        extraction_client.put(
            f"/llm/data-extraction/{doc_id}/validate",
            json={
                "recommendation_number": None,
                "recommendation_date_text": None,
                "topic": None,
                "subtopic": None,
                "personal_data": None,
                "publishable_content": f"Contenido {i}.",
                "recipients": [],
            },
        )

    page_1 = extraction_client.get(
        "/llm/data-extraction/recommendations", params={"page": 1, "page_size": 2}
    ).json()
    page_2 = extraction_client.get(
        "/llm/data-extraction/recommendations", params={"page": 2, "page_size": 2}
    ).json()

    assert page_1["total"] == 3
    assert len(page_1["items"]) == 2
    assert len(page_2["items"]) == 1


def test_learned_index_returns_most_recent_confirmation(
    extraction_client, seeded_catalogs, seeded_organigram_unit
):
    doc_1 = _extract(extraction_client, "Primer documento con Juan Perez.")
    extraction_client.put(
        f"/llm/data-extraction/{doc_1}/validate",
        json={
            "recommendation_number": None,
            "recommendation_date_text": None,
            "topic": None,
            "subtopic": None,
            "personal_data": None,
            "publishable_content": "Primero.",
            "recipients": [
                {
                    "name": "Juan Perez",
                    "position": "un cargo sin relacion",
                    "is_primary": True,
                    "macro_sector": None,
                    "unit_id": str(seeded_organigram_unit.id),
                }
            ],
        },
    )

    # A second, unrelated document mentions the same name with a cargo that
    # doesn't match anything -- the organigram cross-reference alone
    # wouldn't resolve a unit, but the learned index (this exact name was
    # just confirmed) should.
    provider = FakeProvider(
        [
            json.dumps(
                {
                    "recommendation_number": None,
                    "recommendation_date": None,
                    "recipients": [
                        {
                            "name": "Juan Perez",
                            "position": "un cargo sin relacion",
                            "is_primary": True,
                            "macro_sector": "GCBA",
                        }
                    ],
                    "topic": None,
                    "subtopic": None,
                    "personal_data": None,
                    "publishable_content": "Segundo.",
                }
            )
        ]
    )
    with patched_provider(provider):
        response = extraction_client.post(
            "/llm/data-extraction",
            json={"document": _document("Segundo documento con Juan Perez.")},
        )

    assert response.status_code == 200
    recipient = response.json()["recipients"][0]
    assert recipient["unit_id"] == str(seeded_organigram_unit.id)


def test_validate_rejects_a_sector_id_that_isnt_the_units_sector(
    extraction_client, extraction_engine, seeded_catalogs, seeded_organigram_unit
):
    with Session(extraction_engine) as session:
        otro_sector = OrganigramUnit(
            id=uuid.uuid4(), name="Secretaría sin relación", is_sector=True
        )
        session.add(otro_sector)
        session.commit()
        otro_sector_id = otro_sector.id

    document_id = _extract(extraction_client, "Documento con sector inconsistente.")

    response = extraction_client.put(
        f"/llm/data-extraction/{document_id}/validate",
        json={
            "recommendation_number": "5/2024",
            "recommendation_date_text": None,
            "topic": None,
            "subtopic": None,
            "personal_data": None,
            "publishable_content": "Contenido.",
            "recipients": [
                {
                    "name": "Juan Perez",
                    "position": "Ministerio de Salud",
                    "is_primary": True,
                    "macro_sector": "GCBA",
                    "unit_id": str(seeded_organigram_unit.id),
                    "sector_id": str(otro_sector_id),
                }
            ],
        },
    )

    assert response.status_code == 422
