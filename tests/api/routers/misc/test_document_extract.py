import concurrent.futures
import io
import sys
import zipfile
from unittest.mock import patch

import pytest

from aymurai.database.utils import data_to_uuid


def _build_docx_bytes(paragraphs: list[str]) -> bytes:
    import docx

    document = docx.Document()
    for paragraph in paragraphs:
        document.add_paragraph(paragraph)

    stream = io.BytesIO()
    document.save(stream)
    return stream.getvalue()


def _build_docx_with_page_count(page_count: int) -> bytes:
    """Build a minimal DOCX-shaped archive with cached page metadata."""
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main"><w:body/></w:document>',
        )
        archive.writestr(
            "docProps/app.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Properties xmlns="http://schemas.openxmlformats.org/'
            'officeDocument/2006/extended-properties">'
            f"<Pages>{page_count}</Pages>"
            "</Properties>",
        )
    return stream.getvalue()


def _build_pdf_bytes(paragraphs: list[str]) -> bytes:
    import pymupdf

    pdf_document = pymupdf.open()
    page = pdf_document.new_page()  # type: ignore
    for index, paragraph in enumerate(paragraphs):
        page.insert_text((72, 72 + (index * 36)), paragraph)

    try:
        to_bytes = getattr(pdf_document, "tobytes", None)
        if callable(to_bytes):
            serialized = to_bytes()
            if isinstance(serialized, bytes):
                return serialized
            raise TypeError("Expected bytes from pymupdf tobytes()")

        serialized = pdf_document.write()
        if isinstance(serialized, bytes):
            return serialized
        raise TypeError("Expected bytes from pymupdf write()")
    finally:
        pdf_document.close()


@pytest.mark.integration
@pytest.mark.slow
def test_should_extract_real_text_from_sample_docx_without_mocking(client):
    """Test that a generated DOCX is extracted without mocking."""
    expected_paragraphs = [
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
    ]
    file_content = _build_docx_bytes(expected_paragraphs)
    files = {
        "file": (
            "sample.docx",
            file_content,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }

    response = client.post("/api/document-extract", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["document_id"] == str(data_to_uuid(file_content))
    assert data["document"]
    extracted_text = " ".join(data["document"])
    for paragraph in expected_paragraphs:
        assert paragraph in extracted_text


@pytest.mark.integration
@pytest.mark.slow
@pytest.mark.xfail(
    sys.platform == "win32",
    reason="pymupdf4llm ONNX layout model receives int32 tensors on Windows (expects int64)",
    strict=False,
)
def test_should_extract_real_text_from_pdf_without_mocking(client):
    """Test that a real PDF upload is extracted without mocking."""
    expected_paragraphs = [
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
    ]
    file_content = _build_pdf_bytes(expected_paragraphs)
    files = {
        "file": (
            "sample.pdf",
            file_content,
            "application/pdf",
        )
    }

    response = client.post("/api/document-extract", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["document_id"] == str(data_to_uuid(file_content))
    assert data["document"]
    extracted_text = " ".join(data["document"])
    for paragraph in expected_paragraphs:
        assert paragraph in extracted_text


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_return_document_with_paragraphs_when_uploading_docx(
    mock_extraction, client
):
    """Test that document extraction returns paragraphs in response."""
    mock_extraction.return_value = "Para 1\nPara 2\nPara 3"

    files = {
        "file": (
            "test.docx",
            b"test content",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }
    response = client.post("/api/document-extract", files=files)

    assert response.status_code == 200
    data = response.json()
    assert "document" in data
    assert "document_id" in data
    assert isinstance(data["document"], list)
    assert len(data["document"]) == 3
    assert data["document"] == ["Para 1", "Para 2", "Para 3"]


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_return_document_via_misc_prefix_when_uploading(mock_extraction, client):
    """Test that /misc/document-extract endpoint works."""
    mock_extraction.return_value = "Sample text"

    files = {
        "file": (
            "test.docx",
            b"content",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }
    response = client.post("/api/misc/document-extract", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["document"] == ["Sample text"]


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_return_document_via_deprecated_alias_when_uploading(
    mock_extraction, client
):
    """Test that deprecated /document-extract alias is still available."""
    mock_extraction.return_value = "Alias text"

    files = {
        "file": (
            "test.docx",
            b"content",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }
    response = client.post("/api/document-extract", files=files)

    assert response.status_code == 200
    assert response.json()["document"] == ["Alias text"]


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_return_deterministic_id_when_uploading_same_file_twice(
    mock_extraction, client
):
    """Test that same file bytes produce same document_id."""
    mock_extraction.return_value = "Same content"

    file_content = b"identical content"
    files = {
        "file": (
            "test.docx",
            file_content,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }

    response1 = client.post("/api/document-extract", files=files)
    data1 = response1.json()

    # Reset mock and upload same file again
    response2 = client.post("/api/document-extract", files=files)
    data2 = response2.json()

    assert response1.status_code == 200
    assert response2.status_code == 200
    assert data1["document_id"] == data2["document_id"]


@pytest.mark.integration
def test_should_return_422_when_no_file_provided(client):
    """Test that missing file returns 422 Unprocessable Entity."""
    response = client.post("/api/document-extract", files={})

    assert response.status_code == 422


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_return_empty_document_when_file_is_empty(mock_extraction, client):
    """Test that empty extraction returns empty document list."""
    mock_extraction.return_value = ""

    files = {
        "file": (
            "test.docx",
            b"content",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }
    response = client.post("/api/document-extract", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["document"] == []


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_collapse_consecutive_duplicates_when_extracting(
    mock_extraction, client
):
    """Test that consecutive duplicate paragraphs are collapsed."""
    mock_extraction.return_value = "A\nA\nB\nB\nB\nC"

    files = {
        "file": (
            "test.docx",
            b"content",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }
    response = client.post("/api/document-extract", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["document"] == ["A", "B", "C"]


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_normalize_whitespace_when_extracting(mock_extraction, client):
    """Test that multiple spaces are normalized to single space."""
    mock_extraction.return_value = "word1  word2   word3"

    files = {
        "file": (
            "test.docx",
            b"content",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }
    response = client.post("/api/document-extract", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["document"] == ["word1 word2 word3"]


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_return_504_when_extraction_times_out(mock_extraction, client):
    """Test that TimeoutError returns 504 Gateway Timeout."""
    mock_extraction.side_effect = concurrent.futures.TimeoutError()

    files = {
        "file": (
            "test.docx",
            b"content",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }
    response = client.post("/api/document-extract", files=files)

    assert response.status_code == 504


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_return_500_when_extraction_fails(mock_extraction, client):
    """Test that extraction errors return 500 Internal Server Error."""
    mock_extraction.side_effect = Exception("Extraction failed")

    files = {
        "file": (
            "test.docx",
            b"content",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }
    response = client.post("/api/document-extract", files=files)

    assert response.status_code == 500


DOCX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_strip_zero_width_chars_so_predict_offsets_match(
    mock_extraction, client
):
    """Regression: the frontend keeps /document-extract text as its source of
    truth and validates /predict label offsets against it. The predict
    pipeline strips zero-width chars (FlairTextNormalize), so any zero-width
    char surviving extraction shifts every later offset and blocks export
    ("El texto de la entidad no coincide con el texto original en sus
    offsets"). Extracted paragraphs must therefore be fixed points of
    FlairTextNormalize.normalize_text."""
    from aymurai.models.flair.utils import FlairTextNormalize

    mock_extraction.return_value = (
        "A mayor abundamiento,\ufeff a fs. 123/456 la Sra. Mar\u00eda Gonz\u00e1lez.\n"
        "Con\u200b espacios\tय tabulaciones\u200c raras\ufe0f aqu\u00ed."
    )

    response = client.post(
        "/api/misc/document-extract",
        files={
            "file": (
                "test.docx",
                b"content",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert response.status_code == 200
    paragraphs = response.json()["document"]
    assert paragraphs

    for paragraph in paragraphs:
        assert FlairTextNormalize.normalize_text(paragraph) == paragraph, (
            f"extracted paragraph is not aligned with the predict pipeline "
            f"normalization: {paragraph!r}"
        )


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_return_page_count_when_uploading_sample_docx(mock_extraction, client):
    """Test that a DOCX upload reports its cached page count."""
    mock_extraction.return_value = "Para 1\nPara 2"

    file_content = _build_docx_with_page_count(19)
    files = {"file": ("document-01.docx", file_content, DOCX_CONTENT_TYPE)}
    response = client.post("/api/document-extract", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["page_count"] == 19


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_return_null_page_count_when_metadata_unreadable(
    mock_extraction, client
):
    """Test that unreadable metadata yields page_count null with HTTP 200."""
    mock_extraction.return_value = "Para 1"

    files = {"file": ("test.docx", b"not a zip archive at all", DOCX_CONTENT_TYPE)}
    response = client.post("/api/document-extract", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["page_count"] is None


@pytest.mark.integration
@patch("aymurai.api.endpoints.routers.misc.document_extract.run_safe_text_extraction")
def test_should_return_page_count_via_misc_prefix(mock_extraction, client):
    """Test that /misc/document-extract also reports page_count."""
    mock_extraction.return_value = "Para 1"

    file_content = _build_docx_with_page_count(19)
    files = {"file": ("document-01.docx", file_content, DOCX_CONTENT_TYPE)}
    response = client.post("/api/misc/document-extract", files=files)

    assert response.status_code == 200
    assert response.json()["page_count"] == 19


@pytest.mark.integration
@pytest.mark.slow
def test_repro_docx_paragraphs_are_fixed_points_of_predict_normalization(client):
    """Same contract as above, without mocking: a synthetic DOCX whose raw
    paragraphs carry zero-width characters and odd whitespace goes through the
    real extraction path."""
    from aymurai.models.flair.utils import FlairTextNormalize

    file_content = _build_docx_bytes(
        [
            "A mayor abundamiento,\ufeff a fs. 123/456 la Sra. Mar\u00eda Gonz\u00e1lez.",
            "Con\u200b espacios\ty tabulaciones\u200c raras\ufe0f aqu\u00ed.",
            "P\u00e1rrafo final sin caracteres invisibles.",
        ]
    )

    response = client.post(
        "/api/misc/document-extract",
        files={
            "file": (
                "repro.docx",
                file_content,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert response.status_code == 200
    paragraphs = response.json()["document"]
    assert paragraphs

    misaligned = [
        paragraph
        for paragraph in paragraphs
        if FlairTextNormalize.normalize_text(paragraph) != paragraph
    ]
    assert not misaligned, (
        f"{len(misaligned)} extracted paragraph(s) are not aligned with the "
        f"predict pipeline normalization; first: {misaligned[0]!r}"
    )


@pytest.mark.integration
@pytest.mark.slow
def test_should_return_page_count_for_generated_pdf(client):
    """Test that a generated 3-page PDF reports page_count 3."""
    import pymupdf

    pdf_document = pymupdf.open()
    try:
        for index in range(3):
            page = pdf_document.new_page()  # type: ignore[attr-defined]
            page.insert_text((72, 72), f"page {index + 1}")
        file_content = pdf_document.tobytes()
    finally:
        pdf_document.close()

    files = {"file": ("sample.pdf", file_content, "application/pdf")}
    response = client.post("/api/document-extract", files=files)

    assert response.status_code == 200
    assert response.json()["page_count"] == 3
