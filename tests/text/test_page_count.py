from pathlib import Path

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
