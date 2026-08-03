from pathlib import Path

import pytest

from aymurai.text.extractors.base import BaseExtractor


class _DummyExtractor(BaseExtractor):
    """Concrete extractor that does not override page_count."""

    extension = "dummy-page-count"

    def extract(self, path: Path, **_) -> str:
        return ""


def test_base_extractor_page_count_defaults_to_none(tmp_path):
    """A extractor that does not override page_count reports None."""
    document = tmp_path / "sample.dummy-page-count"
    document.write_bytes(b"whatever")

    assert _DummyExtractor().page_count(document) is None


def test_base_extractor_page_count_returns_none_for_missing_file(tmp_path):
    """The default implementation does not touch the filesystem."""
    assert _DummyExtractor().page_count(tmp_path / "does-not-exist.bin") is None


def _build_pdf(path: Path, pages: int) -> Path:
    """Write a PDF with an exact number of blank pages."""
    import pymupdf

    document = pymupdf.open()
    try:
        for index in range(pages):
            page = document.new_page()  # type: ignore[attr-defined]
            page.insert_text((72, 72), f"page {index + 1}")
        document.save(str(path))
    finally:
        document.close()
    return path


def test_pdf_extractor_reports_known_page_count(tmp_path):
    """A PDF built with 3 pages reports 3."""
    from aymurai.text.extractors.pdf import PdfExtractor

    document = _build_pdf(tmp_path / "three.pdf", pages=3)

    assert PdfExtractor().page_count(document) == 3


def test_pdf_extractor_reports_single_page_count(tmp_path):
    """A PDF built with 1 page reports 1."""
    from aymurai.text.extractors.pdf import PdfExtractor

    document = _build_pdf(tmp_path / "one.pdf", pages=1)

    assert PdfExtractor().page_count(document) == 1


def test_pdf_extractor_returns_none_for_non_pdf_bytes(tmp_path):
    """A corrupt PDF resolves to None instead of raising."""
    from aymurai.text.extractors.pdf import PdfExtractor

    document = tmp_path / "broken.pdf"
    document.write_bytes(b"this is definitely not a pdf")

    assert PdfExtractor().page_count(document) is None


def test_pdf_extractor_returns_none_for_missing_file(tmp_path):
    """A missing file resolves to None instead of raising InvalidFile."""
    from aymurai.text.extractors.pdf import PdfExtractor

    assert PdfExtractor().page_count(tmp_path / "missing.pdf") is None


SAMPLE_DIR = Path(__file__).resolve().parents[2] / "resources" / "data" / "sample"

SAMPLE_DOCX_PAGE_COUNTS = {
    "document-01.docx": 19,
    "document-02.docx": 9,
    "document-03.docx": 10,
    "document-04.docx": 19,
    "document-05.docx": 25,
    "document-06.docx": 18,
    "document-07.docx": 10,
    "document-08.docx": 16,
    "document-09.docx": 48,
}

APP_XML_WITHOUT_PAGES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    "<Properties "
    'xmlns="http://schemas.openxmlformats.org/officeDocument/2006/'
    'extended-properties">'
    "<Template>Normal</Template>"
    "<Words>120</Words>"
    "<Application>python-docx</Application>"
    "</Properties>"
)


def _build_docx_with_app_xml(path: Path, app_xml: str | None) -> Path:
    """Write a minimal DOCX-shaped zip with an optional docProps/app.xml."""
    import zipfile

    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main"><w:body/></w:document>',
        )
        if app_xml is not None:
            archive.writestr("docProps/app.xml", app_xml)
    return path


@pytest.mark.parametrize(
    ("filename", "expected"), sorted(SAMPLE_DOCX_PAGE_COUNTS.items())
)
def test_docx_extractor_reports_sample_page_counts(filename, expected):
    """Every sample DOCX carries <Pages> in docProps/app.xml."""
    from aymurai.text.extractors.docx import DocxExtractor

    document = SAMPLE_DIR / filename
    assert document.exists(), f"missing fixture: {document}"

    assert DocxExtractor().page_count(document) == expected


def test_docx_extractor_returns_none_when_pages_element_missing(tmp_path):
    """An app.xml without <Pages> resolves to None."""
    from aymurai.text.extractors.docx import DocxExtractor

    document = _build_docx_with_app_xml(
        tmp_path / "no-pages.docx", APP_XML_WITHOUT_PAGES
    )

    assert DocxExtractor().page_count(document) is None


def test_docx_extractor_returns_none_when_app_xml_missing(tmp_path):
    """A DOCX without docProps/app.xml resolves to None."""
    from aymurai.text.extractors.docx import DocxExtractor

    document = _build_docx_with_app_xml(tmp_path / "no-app-xml.docx", None)

    assert DocxExtractor().page_count(document) is None


def test_docx_extractor_returns_none_for_non_zip_file(tmp_path):
    """A file that is not a valid zip resolves to None, not an exception."""
    from aymurai.text.extractors.docx import DocxExtractor

    document = tmp_path / "not-a-zip.docx"
    document.write_bytes(b"plain text, definitely not a zip archive")

    assert DocxExtractor().page_count(document) is None


def test_docx_extractor_returns_none_for_missing_file(tmp_path):
    """A missing file resolves to None instead of raising InvalidFile."""
    from aymurai.text.extractors.docx import DocxExtractor

    assert DocxExtractor().page_count(tmp_path / "missing.docx") is None
