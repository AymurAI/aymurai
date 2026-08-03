from pathlib import Path
from typing import Any
from zipfile import BadZipFile

import docx2txt

from aymurai.logger import get_logger
from aymurai.text.extractors.base import BaseExtractor, InvalidFile, register_extractor
from aymurai.text.extractors.utils import (
    get_docx_page_count,
    get_footnotes,
    normalize_text,
)

logger = get_logger(__file__)


@register_extractor
class DocxExtractor(BaseExtractor):
    extension = "docx"

    def extract(self, path: Path, **_: Any) -> str:
        file_path = self.ensure_file(path)

        try:
            document_text = docx2txt.process(str(file_path)) or ""
        except (OSError, BadZipFile, KeyError) as exc:
            raise InvalidFile(str(exc)) from exc
        except Exception as exc:
            raise InvalidFile(str(exc)) from exc

        footnotes = get_footnotes(file_path) or []
        footnotes_text = "\n".join(note for note in footnotes if note.strip())

        if footnotes_text:
            document_text = f"{document_text}\n\n{footnotes_text}"

        return normalize_text(document_text)

    def page_count(self, path: Path) -> int | None:
        """
        Read the cached page count of a DOCX document.

        Deliberately catches every exception: a missing page count must never
        fail the caller.

        Args:
            path (Path): DOCX document path.

        Returns:
            int | None: Number of pages, or None when the file is missing,
                unreadable, or carries no ``<Pages>`` metadata.
        """
        try:
            return get_docx_page_count(self.ensure_file(path))
        except Exception as exc:  # noqa: BLE001 - page count must never raise
            logger.warning("Cannot read DOCX page count from '%s': %s", path, exc)
            return None
