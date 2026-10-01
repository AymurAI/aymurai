"""The document's paragraphs survive from extraction to the correction screen."""

import json
from pathlib import Path

import pytest
from httpx import Response
from sqlmodel import Session

from aymurai.api.endpoints.routers.misc.document_extract import (
    _split_document_paragraphs,
    extraction,
)
from aymurai.database.crud.llm_extraction import llm_extraction_create_or_update
from aymurai.database.utils import text_to_uuid

from .conftest import FakeProvider, patched_provider

SAMPLE_DOCX = Path("resources/data/sample/document-01.docx")

EXTRACTION = json.dumps(
    {
        "recommendation_number": None,
        "recommendation_date": None,
        "recipients": [],
        "topic": None,
        "subtopic": None,
        "personal_data": None,
        "publishable_content": "Resumen.",
    }
)

VALIDATION = {
    "recommendation_number": None,
    "recommendation_date_text": None,
    "topic": None,
    "subtopic": None,
    "personal_data": None,
    "publishable_content": "Contenido.",
    "recipients": [],
}


def _validated_detail(client, paragraphs: list[str]) -> Response:
    document_id = str(text_to_uuid("\n".join(paragraphs)))
    with patched_provider(FakeProvider([EXTRACTION])):
        extracted = client.post(
            "/llm/data-extraction",
            json={"document": {"document": paragraphs, "document_id": document_id}},
        )
    assert extracted.status_code == 200
    validated = client.put(
        f"/llm/data-extraction/{document_id}/validate", json=VALIDATION
    )
    assert validated.status_code == 200
    detail = client.get(
        f"/llm/data-extraction/recommendations/{validated.json()['id']}"
    )
    assert detail.status_code == 200
    return detail


def test_detail_returns_the_paragraphs_the_extraction_received(
    extraction_client, seeded_catalogs
):
    paragraphs = ["Visto el expediente,\ny considerando:", "Se recomienda."]

    detail = _validated_detail(extraction_client, paragraphs).json()

    assert detail["source_paragraphs"] == paragraphs
    # `source_text` is still the joined text, unchanged.
    assert detail["source_text"] == "\n".join(paragraphs)


@pytest.mark.skipif(not SAMPLE_DOCX.exists(), reason="sample documents not present")
def test_real_document_paragraphs_round_trip(extraction_client, seeded_catalogs):
    # The actual paragraph-splitting path of `/document-extract`, on a sample
    # where a paragraph carries its own newline -- which `source_text` alone
    # cannot tell apart from a paragraph boundary.
    paragraphs = _split_document_paragraphs(extraction(str(SAMPLE_DOCX)))
    assert any("\n" in paragraph for paragraph in paragraphs)
    assert "\n".join(paragraphs).split("\n") != paragraphs

    detail = _validated_detail(extraction_client, paragraphs).json()

    assert detail["source_paragraphs"] == paragraphs


def test_detail_of_a_legacy_extraction_has_no_paragraphs(
    extraction_client, extraction_engine, seeded_catalogs
):
    document_id = text_to_uuid("Extracción anterior a los párrafos.")
    with Session(extraction_engine) as session:
        llm_extraction_create_or_update(
            document_id,
            None,
            "Extracción anterior a los párrafos.",
            json.loads(EXTRACTION),
            {"model": "fake-model"},
            session,
        )
    validated = extraction_client.put(
        f"/llm/data-extraction/{document_id}/validate", json=VALIDATION
    )
    assert validated.status_code == 200

    detail = extraction_client.get(
        f"/llm/data-extraction/recommendations/{validated.json()['id']}"
    ).json()

    assert detail["source_paragraphs"] is None
    assert detail["source_text"] == "Extracción anterior a los párrafos."
