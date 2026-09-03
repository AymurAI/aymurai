from aymurai.database.crud.llm_extraction import (
    llm_extraction_create_or_update,
    llm_extraction_get,
)
from aymurai.database.utils import text_to_uuid


def test_create_or_update_creates_new_record_when_missing(session):
    extraction_id = text_to_uuid("doc-1")

    record = llm_extraction_create_or_update(
        extraction_id,
        "doc-1.pdf",
        "texto del documento",
        {"topic": "SALUD", "recipients": []},
        {"model": "gemma", "catalogs_hash": "abc"},
        session,
    )

    assert record.id == extraction_id
    assert record.file_name == "doc-1.pdf"
    assert record.prediction["topic"] == "SALUD"
    assert record.config["catalogs_hash"] == "abc"


def test_get_returns_none_when_not_found(session):
    assert llm_extraction_get(text_to_uuid("missing"), session) is None


def test_create_or_update_overwrites_existing_record(session):
    extraction_id = text_to_uuid("doc-2")

    llm_extraction_create_or_update(
        extraction_id, None, "v1", {"topic": "SALUD"}, {"model": "a"}, session
    )
    updated = llm_extraction_create_or_update(
        extraction_id, None, "v2", {"topic": "VIVIENDA"}, {"model": "b"}, session
    )

    assert updated.source_text == "v2"
    assert updated.prediction["topic"] == "VIVIENDA"
    assert updated.config["model"] == "b"
    assert llm_extraction_get(extraction_id, session).source_text == "v2"
