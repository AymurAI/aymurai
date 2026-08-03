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
