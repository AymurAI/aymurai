import zipfile
from pathlib import Path
from typing import Any
from zipfile import BadZipFile

import docx2txt
from lxml import etree

from aymurai.text.extractors.base import BaseExtractor, InvalidFile, register_extractor
from aymurai.text.extractors.normalization import normalize_text


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
