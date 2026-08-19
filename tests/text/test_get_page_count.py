import zipfile
from pathlib import Path

from aymurai.text.extraction import get_page_count

SAMPLE_DIR = Path(__file__).resolve().parents[2] / "resources" / "data" / "sample"

ODT_META_XML = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    "<office:document-meta "
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" '
    'office:version="1.2">'
    "<office:meta>"
    '<meta:document-statistic meta:page-count="4" meta:word-count="90"/>'
    "</office:meta>"
    "</office:document-meta>"
)

ODT_CONTENT_XML = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    "<office:document-content "
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
    'office:version="1.2">'
    "<office:body><office:text>"
    "<text:p>hola</text:p>"
    "</office:text></office:body>"
    "</office:document-content>"
)


def test_get_page_count_reads_docx_sample():
    """A real sample DOCX dispatches to DocxExtractor.page_count."""
    document = SAMPLE_DIR / "document-01.docx"
    assert document.exists(), f"missing fixture: {document}"

    assert get_page_count(str(document)) == 19


def test_get_page_count_reads_pdf(tmp_path):
    """A generated PDF dispatches to PdfExtractor.page_count."""
    import pymupdf

    document = tmp_path / "five.pdf"
    pdf = pymupdf.open()
    try:
        for index in range(5):
            page = pdf.new_page()  # type: ignore[attr-defined]
            page.insert_text((72, 72), f"page {index + 1}")
        pdf.save(str(document))
    finally:
        pdf.close()

    assert get_page_count(str(document)) == 5


def test_get_page_count_reads_odt(tmp_path):
    """A minimal ODT dispatches to OdtExtractor.page_count."""
    document = tmp_path / "four.odt"
    with zipfile.ZipFile(document, "w") as archive:
        archive.writestr("mimetype", "application/vnd.oasis.opendocument.text")
        archive.writestr("content.xml", ODT_CONTENT_XML)
        archive.writestr("meta.xml", ODT_META_XML)

    assert get_page_count(str(document)) == 4


def test_get_page_count_returns_none_for_unsupported_extension(tmp_path):
    """An unsupported extension resolves to None instead of raising."""
    document = tmp_path / "notes.txt"
    document.write_text("plain text", encoding="utf-8")

    assert get_page_count(str(document)) is None


def test_get_page_count_returns_none_for_missing_file(tmp_path):
    """A missing path resolves to None instead of raising."""
    assert get_page_count(str(tmp_path / "missing.docx")) is None


def test_get_page_count_returns_none_for_corrupt_docx(tmp_path):
    """A .docx that is not a zip resolves to None instead of raising."""
    document = tmp_path / "broken.docx"
    document.write_bytes(b"definitely not a zip archive")

    assert get_page_count(str(document)) is None


def test_get_page_count_reads_second_docx_sample():
    """A second sample DOCX confirms the value is read per file, not cached."""
    document = SAMPLE_DIR / "document-02.docx"
    assert document.exists(), f"missing fixture: {document}"

    assert get_page_count(str(document)) == 9
