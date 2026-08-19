from aymurai.database.utils import text_to_uuid
from aymurai.meta.api_interfaces import Document


def test_document_page_count_defaults_to_none():
    """Existing construction sites keep working without page_count."""
    document = Document(document=["hola"], document_id=text_to_uuid("hola"))

    assert document.page_count is None


def test_document_accepts_page_count():
    """page_count is stored when supplied."""
    document = Document(
        document=["hola"],
        document_id=text_to_uuid("hola"),
        page_count=19,
    )

    assert document.page_count == 19


def test_document_serializes_page_count_as_null_when_absent():
    """The JSON payload always carries the key, null when unknown."""
    document = Document(document=["hola"], document_id=text_to_uuid("hola"))
    payload = document.model_dump(mode="json")

    assert "page_count" in payload
    assert payload["page_count"] is None


def test_document_serializes_page_count_when_present():
    """The JSON payload carries the integer when known."""
    document = Document(
        document=["hola"],
        document_id=text_to_uuid("hola"),
        page_count=3,
    )
    payload = document.model_dump(mode="json")

    assert payload["page_count"] == 3
