import json
import uuid
from datetime import datetime, timedelta

import pytest
from sqlmodel import Session

from aymurai.database.schema import Recommendation
from aymurai.database.utils import text_to_uuid

from .conftest import FakeProvider, patched_provider


def _document(text: str) -> dict:
    return {"document": [text], "document_id": str(text_to_uuid(text))}


def _extraction_payload(**overrides) -> str:
    payload = {
        "recommendation_number": "5/2024",
        "recommendation_date": "01 de enero de 2024",
        "recipients": [],
        "topic": None,
        "subtopic": None,
        "personal_data": None,
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


def _validate(client, document_id: str, **overrides) -> dict:
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
    response = client.put(f"/llm/data-extraction/{document_id}/validate", json=payload)
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def seeded_ordering_recommendations(
    extraction_client, extraction_engine, seeded_catalogs
):
    """
    Seeds three recommendations, A/B/C, through the real extract -> validate
    -> PATCH-seguimiento cycle, with distinct values on every whitelisted
    order column except `recommendation_date`/`status` on C, which are left
    unset -- C is the "needs a human" row: unparsed date prose plus no
    seguimiento status yet, used both by the unparsed_dates filter tests and
    the nulls-last ordering tests.

    `created_at` is the one column this can't control through the API (it's
    a DB server default) -- it's overridden directly afterwards, spaced an
    hour apart, so ordering by it is deterministic regardless of how fast the
    three HTTP round-trips actually ran.
    """
    doc_a = _extract(extraction_client, "Documento de orden A.")
    doc_b = _extract(extraction_client, "Documento de orden B.")
    doc_c = _extract(extraction_client, "Documento de orden C.")

    rec_a = _validate(
        extraction_client,
        doc_a,
        recommendation_number="0100",
        recommendation_date_text="01 de enero de 2024",
        publishable_content="Contenido orden A.",
    )
    rec_b = _validate(
        extraction_client,
        doc_b,
        recommendation_number="0200",
        recommendation_date_text="01 de febrero de 2024",
        publishable_content="Contenido orden B.",
    )
    rec_c = _validate(
        extraction_client,
        doc_c,
        recommendation_number="0300",
        # No recognizable date shape -- parse_recommendation_date returns
        # None, so recommendation_date stays null while the text is kept.
        recommendation_date_text="fecha sin formato reconocible",
        publishable_content="Contenido orden C.",
    )

    patch_a = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{rec_a['id']}",
        json={
            "file_number": "AAA-file",
            "recommendation_situation": "Respuesta",
            "status": "No solucionado",
        },
    )
    assert patch_a.status_code == 200
    patch_b = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{rec_b['id']}",
        json={
            "file_number": "BBB-file",
            "recommendation_situation": "Respuesta parcial",
            "status": "Solucionado",
        },
    )
    assert patch_b.status_code == 200
    # C only gets file_number/situation -- status is deliberately left null,
    # so status-ordering tests exercise nulls-last too.
    patch_c = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{rec_c['id']}",
        json={
            "file_number": "CCC-file",
            "recommendation_situation": "Notificado",
        },
    )
    assert patch_c.status_code == 200

    ids = {"A": rec_a["id"], "B": rec_b["id"], "C": rec_c["id"]}

    base = datetime(2024, 6, 1, 12, 0, 0)
    with Session(extraction_engine) as session:
        for key, offset_hours in (("A", 0), ("B", 1), ("C", 2)):
            recommendation = session.get(Recommendation, uuid.UUID(ids[key]))
            recommendation.created_at = base + timedelta(hours=offset_hours)
            session.add(recommendation)
        session.commit()

    return ids


def _ids_in_response(response) -> list[str]:
    assert response.status_code == 200
    return [item["id"] for item in response.json()["items"]]


def test_order_by_recommendation_number_both_directions(
    extraction_client, seeded_ordering_recommendations
):
    ids = seeded_ordering_recommendations

    asc = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "recommendation_number", "order_dir": "asc"},
    )
    assert _ids_in_response(asc) == [ids["A"], ids["B"], ids["C"]]

    desc = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "recommendation_number", "order_dir": "desc"},
    )
    assert _ids_in_response(desc) == [ids["C"], ids["B"], ids["A"]]


def test_order_by_file_number_both_directions(
    extraction_client, seeded_ordering_recommendations
):
    ids = seeded_ordering_recommendations

    asc = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "file_number", "order_dir": "asc"},
    )
    assert _ids_in_response(asc) == [ids["A"], ids["B"], ids["C"]]

    desc = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "file_number", "order_dir": "desc"},
    )
    assert _ids_in_response(desc) == [ids["C"], ids["B"], ids["A"]]


def test_order_by_recommendation_situation_both_directions(
    extraction_client, seeded_ordering_recommendations
):
    ids = seeded_ordering_recommendations

    # "Notificado" < "Respuesta" < "Respuesta parcial" -- 'N' sorts before
    # 'R', and "Respuesta" is a strict prefix of "Respuesta parcial".
    asc = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "recommendation_situation", "order_dir": "asc"},
    )
    assert _ids_in_response(asc) == [ids["C"], ids["A"], ids["B"]]

    desc = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "recommendation_situation", "order_dir": "desc"},
    )
    assert _ids_in_response(desc) == [ids["B"], ids["A"], ids["C"]]


def test_order_by_created_at_both_directions(
    extraction_client, seeded_ordering_recommendations
):
    ids = seeded_ordering_recommendations

    asc = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "created_at", "order_dir": "asc"},
    )
    assert _ids_in_response(asc) == [ids["A"], ids["B"], ids["C"]]

    desc = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "created_at", "order_dir": "desc"},
    )
    assert _ids_in_response(desc) == [ids["C"], ids["B"], ids["A"]]


def test_order_by_default_is_created_at_desc(
    extraction_client, seeded_ordering_recommendations
):
    ids = seeded_ordering_recommendations

    default = extraction_client.get("/llm/data-extraction/recommendations")
    assert _ids_in_response(default) == [ids["C"], ids["B"], ids["A"]]


def test_order_by_status_nulls_last_both_directions(
    extraction_client, seeded_ordering_recommendations
):
    ids = seeded_ordering_recommendations  # C's status is null

    asc = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "status", "order_dir": "asc"},
    )
    assert _ids_in_response(asc) == [ids["A"], ids["B"], ids["C"]]

    desc = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "status", "order_dir": "desc"},
    )
    assert _ids_in_response(desc) == [ids["B"], ids["A"], ids["C"]]


def test_order_by_recommendation_date_nulls_last_both_directions(
    extraction_client, seeded_ordering_recommendations
):
    ids = seeded_ordering_recommendations  # C's recommendation_date is null

    asc = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "recommendation_date", "order_dir": "asc"},
    )
    assert _ids_in_response(asc) == [ids["A"], ids["B"], ids["C"]]

    desc = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "recommendation_date", "order_dir": "desc"},
    )
    assert _ids_in_response(desc) == [ids["B"], ids["A"], ids["C"]]


def test_order_by_outside_whitelist_returns_422(
    extraction_client, seeded_ordering_recommendations
):
    response = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "topic"},
    )
    assert response.status_code == 422


def test_order_dir_outside_whitelist_returns_422(
    extraction_client, seeded_ordering_recommendations
):
    response = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "recommendation_number", "order_dir": "sideways"},
    )
    assert response.status_code == 422


def test_unparsed_dates_filter_returns_exact_rows(
    extraction_client, seeded_ordering_recommendations
):
    ids = seeded_ordering_recommendations  # only C has text but no parsed date

    response = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"unparsed_dates": "true"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [ids["C"]]
    assert body["items"][0]["recommendation_date_text"] == (
        "fecha sin formato reconocible"
    )
    assert body["items"][0]["recommendation_date"] is None


def test_total_reflects_filtered_count_not_page_size(
    extraction_client, seeded_ordering_recommendations
):
    response = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"page": 1, "page_size": 1, "unparsed_dates": "true"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1  # matches the real filtered count
    assert len(body["items"]) == 1  # capped by page_size, same number here

    # Now a filter matching more rows than the page: total must still be the
    # real count, not the length of the one page returned.
    response_all = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"page": 1, "page_size": 2},
    )
    assert response_all.status_code == 200
    body_all = response_all.json()
    assert body_all["total"] == 3
    assert len(body_all["items"]) == 2


def test_order_by_last_edited_is_whitelisted(
    extraction_client, seeded_ordering_recommendations
):
    # The fixture's created_at override touches every row, so all three carry
    # an `updated_at` of "now": this only pins the whitelist; the semantics
    # are covered in tests/database/test_recommendation_list_ordering.py.
    response = extraction_client.get(
        "/llm/data-extraction/recommendations",
        params={"order_by": "last_edited", "order_dir": "desc"},
    )
    assert response.status_code == 200
    assert response.json()["total"] == 3
