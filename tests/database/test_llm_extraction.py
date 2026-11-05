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


def test_create_or_update_preserves_file_name_when_none_passed(session):
    """Test that re-extracting with file_name=None doesn't erase the original file name.

    When re-running extraction on a document, the caller may not have the original file name
    available (file_name=None). This should not destroy the previously-saved file_name, as
    the schema has no way to express "clear the file name" — None only ever means
    "caller doesn't know."
    """
    extraction_id = text_to_uuid("doc-3")
    original_file_name = "Resolucion-1234-24.docx"

    # Create with original file name
    created = llm_extraction_create_or_update(
        extraction_id,
        file_name=original_file_name,
        source_text="v1",
        prediction={"topic": "SALUD"},
        config={"model": "a"},
        session=session,
    )
    assert created.file_name == original_file_name

    # Re-extract with file_name=None (caller doesn't know it)
    updated = llm_extraction_create_or_update(
        extraction_id,
        file_name=None,
        source_text="v2",
        prediction={"topic": "VIVIENDA"},
        config={"model": "b"},
        session=session,
    )

    # File name should survive (not be erased by None)
    assert updated.file_name == original_file_name
    assert llm_extraction_get(extraction_id, session).file_name == original_file_name


def test_create_or_update_stores_and_replaces_source_paragraphs(session):
    extraction_id = text_to_uuid("doc-4")
    paragraphs = ["Primer párrafo\ncon un salto interno.", "Segundo párrafo."]

    created = llm_extraction_create_or_update(
        extraction_id,
        None,
        "\n".join(paragraphs),
        {"topic": "SALUD"},
        {"model": "a"},
        session,
        source_paragraphs=paragraphs,
    )
    assert created.source_paragraphs == paragraphs

    updated = llm_extraction_create_or_update(
        extraction_id,
        None,
        "Otro.",
        {"topic": "SALUD"},
        {"model": "a"},
        session,
        source_paragraphs=["Otro."],
    )
    stored = llm_extraction_get(extraction_id, session)
    assert stored is not None
    assert stored.source_paragraphs == ["Otro."]
    assert updated.source_text == "Otro."


def test_create_without_source_paragraphs_leaves_them_null(session):
    record = llm_extraction_create_or_update(
        text_to_uuid("doc-5"), None, "texto", {}, {}, session
    )
    assert record.source_paragraphs is None
