from pathlib import Path
from typing import Any
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile

from aymurai.logger import get_logger
from aymurai.text.extractors.base import BaseExtractor, InvalidFile, register_extractor
from aymurai.text.extractors.utils import (
    get_header,
    get_odt_page_count,
    normalize_text,
    odt_to_text,
)

logger = get_logger(__file__)


@register_extractor
class OdtExtractor(BaseExtractor):
    extension = "odt"

    def extract(self, path: Path, **_: Any) -> str:
        file_path = self.ensure_file(path)

        try:
            document_text = odt_to_text(file_path)
        except (OSError, ValueError, BadZipFile, KeyError, ParseError) as exc:
            raise InvalidFile(str(exc)) from exc

        header = "\n".join(get_header(file_path)).strip()
        if header:
            document_text = f"{header}\n\n{document_text}"

        return normalize_text(document_text)

    def page_count(self, path: Path) -> int | None:
        """
        Read the cached page count of an ODT document.

        Deliberately catches every exception: a missing page count must never
        fail the caller.

        Args:
            path (Path): ODT document path.

        Returns:
            int | None: Number of pages, or None when the file is missing,
                unreadable, or carries no ``meta:document-statistic`` entry.
        """
        try:
            return get_odt_page_count(self.ensure_file(path))
        except Exception as exc:  # noqa: BLE001 - page count must never raise
            logger.warning("Cannot read ODT page count from '%s': %s", path, exc)
            return None
