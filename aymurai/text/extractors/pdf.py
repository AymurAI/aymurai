from pathlib import Path
from typing import Any

from aymurai.logger import get_logger
from aymurai.text.extractors.base import BaseExtractor, InvalidFile, register_extractor
from aymurai.text.extractors.utils import get_pdf_page_count, pdf_to_text

logger = get_logger(__file__)


@register_extractor
class PdfExtractor(BaseExtractor):
    extension = "pdf"

    def extract(self, path: Path, **_: Any) -> str:
        file_path = self.ensure_file(path)

        try:
            return pdf_to_text(file_path)
        except (OSError, ValueError) as exc:
            raise InvalidFile(str(exc)) from exc
        except Exception as exc:
            raise InvalidFile(str(exc)) from exc

    def page_count(self, path: Path) -> int | None:
        """
        Read the number of pages of a PDF document.

        Deliberately catches every exception: a missing page count must never
        fail the caller.

        Args:
            path (Path): Input document path.

        Returns:
            int | None: Number of pages, or None when the file is missing or
                unreadable.
        """
        try:
            return get_pdf_page_count(self.ensure_file(path))
        except Exception as exc:  # noqa: BLE001 - page count must never raise
            logger.warning("Cannot read PDF page count from '%s': %s", path, exc)
            return None
