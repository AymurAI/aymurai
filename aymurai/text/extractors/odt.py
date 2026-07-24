import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile

import xmltodict
from more_itertools import flatten

from aymurai.text.extractors.base import BaseExtractor, InvalidFile, register_extractor
from aymurai.text.extractors.normalization import normalize_text
from aymurai.utils.misc import get_element, get_recursively

ODT_NS = {"text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0"}


def load_xml_from_odt(path: Path, xmlfile: str = "styles.xml") -> str:
    """
    Load XML content from an ODT archive member.

    Args:
        path (Path): ODT archive path.
        xmlfile (str, optional): Member name to open. Defaults to "styles.xml".

    Returns:
        str: UTF-8 decoded XML content or an empty string when absent.
    """
    with zipfile.ZipFile(path, "r") as odt:
        if xmlfile not in odt.namelist():
            return ""
        with odt.open(xmlfile) as file:
            return file.read().decode("utf-8")


def get_header(path: Path) -> list[str]:
    """
    Extract header text defined in an ODT stylesheet.

    Args:
        path (Path): ODT document path.

    Returns:
        list[str]: Header snippets collected from the stylesheet.
    """
    styles_xml_content = load_xml_from_odt(path)
    if not styles_xml_content:
        return []

    styles_dict = xmltodict.parse(styles_xml_content)

    header_root = get_element(
        styles_dict,
        levels=[
            "office:document-styles",
            "office:master-styles",
            "style:master-page",
        ],
    )

    if not isinstance(header_root, list):
        header_root = [header_root]

    style_header = [
        get_recursively(item, "style:header")
        for item in header_root
        if get_recursively(item, "style:header")
    ]
    style_header = list(flatten(style_header))

    texts = [
        get_recursively(item, "#text")
        for item in style_header
        if get_recursively(item, "#text")
    ]
    texts = list(flatten(texts))

    return [text for text in texts if isinstance(text, str)]


def _odt_qn(name: str) -> str:
    """
    Resolve a qualified ODT tag into the ElementTree namespace form.

    Args:
        name (str): Namespaced tag in the ``prefix:local`` format.

    Returns:
        str: Expanded tag with namespace URI.
    """
    prefix, local = name.split(":", 1)
    return f"{{{ODT_NS[prefix]}}}{local}"


def _odt_text_to_string(elem) -> str:
    """
    Flatten an ODT Element into a plain-text string, preserving special tokens.

    Args:
        elem (Element): XML element to flatten.

    Returns:
        str: Concatenated text content for the element subtree.
    """
    out = elem.text or ""
    for child in elem:
        if child.tag == _odt_qn("text:tab"):
            out += "\t"
        elif child.tag == _odt_qn("text:s"):
            out += " " * int(child.get(_odt_qn("text:c"), 1))
        else:
            out += _odt_text_to_string(child)
        if child.tail:
            out += child.tail
    return out


def odt_to_text(path: Path) -> str:
    """
    Extract text content, preserving paragraphs and headings, from an ODT file.

    Args:
        path (Path): ODT document path.

    Returns:
        str: Plain text version of the document content.
    """
    with zipfile.ZipFile(path, "r") as archive:
        content_xml = archive.read("content.xml")

    content = ET.fromstring(content_xml)

    lines = []
    for child in content.iter():
        if child.tag in (_odt_qn("text:p"), _odt_qn("text:h")):
            lines.append(_odt_text_to_string(child))
    return "\n".join(lines)


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
