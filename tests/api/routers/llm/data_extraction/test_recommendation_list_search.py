"""
The grilla's free-text search (`q`) spans the four columns that live directly
on `Recommendation`: `recommendation_number`, `file_number`,
`recommendation_detail` and `publishable_content`. It used to look at
`publishable_content` alone, so typing an expediente number returned nothing.
"""

import json
from dataclasses import dataclass

import pytest

from aymurai.database.utils import text_to_uuid

from .conftest import FakeProvider, patched_provider


@dataclass
class SearchIds:
    """The three seeded recommendations, one per column under test."""

    number: str
    file: str
    detail: str


def _extraction_payload() -> str:
    return json.dumps(
        {
            "recommendation_number": "5/2024",
            "recommendation_date": "01 de enero de 2024",
            "recipients": [],
            "topic": None,
            "subtopic": None,
            "personal_data": None,
            "publishable_content": "Resumen.",
        }
    )


def _extract(client, text: str) -> str:
    provider = FakeProvider([_extraction_payload()])
    with patched_provider(provider):
        response = client.post(
            "/llm/data-extraction",
            json={
                "document": {
                    "document": [text],
                    "document_id": str(text_to_uuid(text)),
                }
            },
        )
    assert response.status_code == 200
    return response.json()["document_id"]


def _validate(client, document_id: str, **overrides) -> str:
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
    return response.json()["id"]


@pytest.fixture
def seeded_search_recommendations(extraction_client, seeded_catalogs) -> SearchIds:
    """
    Three rows whose `publishable_content` is deliberately identical and free
    of every needle the tests search for -- so a hit can only come from the
    column under test, never from the one the filter used to check alone.
    """
    shared_content = "Texto compartido sin datos distintivos."

    doc_number = _extract(extraction_client, "Documento de búsqueda por número.")
    doc_file = _extract(extraction_client, "Documento de búsqueda por expediente.")
    doc_detail = _extract(extraction_client, "Documento de búsqueda por detalle.")

    rec_number = _validate(
        extraction_client,
        doc_number,
        recommendation_number="7742/2026",
        publishable_content=shared_content,
    )
    rec_file = _validate(
        extraction_client,
        doc_file,
        recommendation_number="0002/2026",
        publishable_content=shared_content,
    )
    rec_detail = _validate(
        extraction_client,
        doc_detail,
        recommendation_number="0003/2026",
        publishable_content=shared_content,
    )

    patch_file = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{rec_file}",
        json={"file_number": "EX-2026-98765"},
    )
    assert patch_file.status_code == 200
    patch_detail = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{rec_detail}",
        json={"recommendation_detail": "Pendiente de respuesta del Ministerio"},
    )
    assert patch_detail.status_code == 200

    return SearchIds(number=rec_number, file=rec_file, detail=rec_detail)


def _search(client, needle: str) -> list[str]:
    response = client.get("/llm/data-extraction/recommendations", params={"q": needle})
    assert response.status_code == 200
    return [item["id"] for item in response.json()["items"]]


def test_search_matches_file_number(extraction_client, seeded_search_recommendations):
    ids = seeded_search_recommendations

    assert _search(extraction_client, "98765") == [ids.file]


def test_search_matches_recommendation_number(
    extraction_client, seeded_search_recommendations
):
    ids = seeded_search_recommendations

    assert _search(extraction_client, "7742") == [ids.number]


def test_search_matches_recommendation_detail(
    extraction_client, seeded_search_recommendations
):
    ids = seeded_search_recommendations

    # Lowercase needle against a capitalized stored value: the match is
    # case-insensitive on both sides.
    assert _search(extraction_client, "ministerio") == [ids.detail]


def test_search_still_matches_publishable_content(
    extraction_client, seeded_search_recommendations
):
    ids = seeded_search_recommendations

    # The column the filter already covered: every row shares this text.
    assert set(_search(extraction_client, "sin datos distintivos")) == {
        ids.number,
        ids.file,
        ids.detail,
    }


def test_search_does_not_match_unrelated_text(
    extraction_client, seeded_search_recommendations
):
    del seeded_search_recommendations

    assert _search(extraction_client, "no-existe-en-ninguna-columna") == []


def test_search_treats_wildcards_literally(
    extraction_client, seeded_search_recommendations
):
    del seeded_search_recommendations

    # `%` is escaped, so it matches itself rather than every row.
    assert _search(extraction_client, "%") == []


@dataclass
class AccentIds:
    """Two rows whose distinguishing text carries non-ASCII letters."""

    lower_accented: str
    upper_accented: str


@pytest.fixture
def seeded_accented_recommendations(extraction_client, seeded_catalogs) -> AccentIds:
    """
    SQLite's own `lower()` only folds ASCII, so `Á`/`Ñ` survive it untouched:
    these rows are what proves the search folds case *and* accents on both
    the stored text and the query.
    """
    doc_lower = _extract(extraction_client, "Documento con tildes en minúscula.")
    doc_upper = _extract(extraction_client, "Documento con tildes en mayúscula.")

    rec_lower = _validate(
        extraction_client,
        doc_lower,
        recommendation_number="0010/2026",
        publishable_content="Pedido al área de niñez.",
    )
    rec_upper = _validate(
        extraction_client,
        doc_upper,
        recommendation_number="0011/2026",
        publishable_content="Texto neutro.",
    )
    patch = extraction_client.patch(
        f"/llm/data-extraction/recommendations/{rec_upper}",
        json={"recommendation_detail": "ÁREA DE SALUD"},
    )
    assert patch.status_code == 200
    return AccentIds(lower_accented=rec_lower, upper_accented=rec_upper)


def test_search_folds_accents_and_case_of_the_query(
    extraction_client, seeded_accented_recommendations
):
    ids = seeded_accented_recommendations

    # Uppercase accented query against lowercase accented data, and the
    # other way round: both sides go through the same normalization.
    assert _search(extraction_client, "ÁREA DE NIÑEZ") == [ids.lower_accented]
    assert _search(extraction_client, "área de salud") == [ids.upper_accented]


def test_search_matches_accented_data_with_unaccented_query(
    extraction_client, seeded_accented_recommendations
):
    ids = seeded_accented_recommendations

    assert set(_search(extraction_client, "area")) == {
        ids.lower_accented,
        ids.upper_accented,
    }
    assert _search(extraction_client, "ninez") == [ids.lower_accented]


def test_search_treats_underscore_literally(
    extraction_client, seeded_accented_recommendations
):
    del seeded_accented_recommendations

    # `_` is LIKE's single-char wildcard: escaped, it matches only itself.
    assert _search(extraction_client, "_") == []
    assert _search(extraction_client, "%rea") == []


def test_whitespace_only_search_returns_everything(
    extraction_client, seeded_search_recommendations
):
    ids = seeded_search_recommendations

    # `q` is normalized (and so stripped) before matching: a query of only
    # spaces is no query at all, not a search for literal spaces.
    assert set(_search(extraction_client, "   ")) == {ids.number, ids.file, ids.detail}
