import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any
from zipfile import BadZipFile

import docx2txt
from lxml import etree

from aymurai.logger import get_logger
from aymurai.text.extractors.base import BaseExtractor, InvalidFile, register_extractor
from aymurai.text.extractors.normalization import normalize_text

logger = get_logger(__file__)

DOCX_EXTENDED_PROPERTIES_NS = (
    "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
)


def load_xml_from_docx(path: Path, xmlfile: str = "word/footnotes.xml") -> Any | None:
    """
    Extract XML content from a specific file inside a DOCX container.

    Args:
        path (Path): DOCX archive path.
        xmlfile (str, optional): Internal member name to inspect. Defaults to "word/footnotes.xml".

    Returns:
        Any | None: Parsed XML tree or None when the member is missing.
    """
    with zipfile.ZipFile(path, "r") as docx:
        if xmlfile not in docx.namelist():
            return None
        with docx.open(xmlfile) as handle:
            return etree.parse(handle)


def get_footnotes(path: Path) -> list[str] | None:
    """
    Extract footnotes from a DOCX document.

    Args:
        path (Path): DOCX document path.

    Returns:
        list[str] | None: Ordered footnote texts or None when absent.
    """
    footnotes_tree = load_xml_from_docx(path)
    if not footnotes_tree:
        return None

    footnotes_root = footnotes_tree.getroot()
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

    footnotes_texts: list[str] = []
    for footnote in footnotes_root.findall("w:footnote", namespaces=ns):
        texts = footnote.xpath(".//w:t/text()", namespaces=ns)
        if texts:
            footnotes_texts.append("".join(texts))

    return footnotes_texts


def get_docx_page_count(path: Path) -> int | None:
    """
    Read the cached page count of a DOCX document.

    DOCX has no intrinsic pagination: the value comes from ``docProps/app.xml``
    and is written by whichever application last saved the file.

    Args:
        path (Path): DOCX archive path.

    Returns:
        int | None: Number of pages, or None when the archive carries no
            ``docProps/app.xml`` or no ``<Pages>`` element.
    """
    with zipfile.ZipFile(path, "r") as archive:
        if "docProps/app.xml" not in archive.namelist():
            return None
        app_xml = archive.read("docProps/app.xml")

    root = ET.fromstring(app_xml)
    pages = root.find(f"{{{DOCX_EXTENDED_PROPERTIES_NS}}}Pages")
    if pages is None:
        return None

    value = (pages.text or "").strip()
    if not value:
        return None

    return int(value)


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
