import re
from collections.abc import Set
from pathlib import Path
from typing import Any

import pymupdf
import pymupdf.layout  # activates layout support
import pymupdf4llm

from aymurai.logger import get_logger
from aymurai.text.extractors.base import BaseExtractor, InvalidFile, register_extractor
from aymurai.text.extractors.normalization import normalize_text

logger = get_logger(__file__)

# Only formula boxes are skipped. Table and picture boxes MUST be extracted:
# any text the extractor drops never reaches the NER model or the validation
# UI, so it can never be labeled and leaks verbatim into anonymized exports
# (e.g. personnel tables with names/DNIs, text inside signature stamps).
PDF_SKIP_BOX_CLASSES = frozenset({"formula"})


def _clean_pdf_box_text(text: str, box_class: str) -> str:
    """
    Clean box-level PDF text while preserving the original layout content.

    Args:
        text (str): Raw text sliced from a page box.
        box_class (str): Box class emitted by ``pymupdf4llm``.

    Returns:
        str: Cleaned, normalized box text.
    """
    text = normalize_text(text).strip()
    if box_class == "footnote":
        text = re.sub(r"(?m)^>\s?", "", text)
    return text


def pdf_to_paragraphs(
    file_path: Path | str,
    *,
    include_headers: bool = True,
    include_footers: bool = True,
    skip_box_classes: Set[str] = PDF_SKIP_BOX_CLASSES,
) -> list[str]:
    """
    Extract paragraph-like layout units from a PDF using PyMuPDF layout parsing.

    Args:
        file_path (Path | str): Path to the PDF document.
        include_headers (bool): Whether to keep header boxes. Defaults to True.
        include_footers (bool): Whether to keep footer boxes. Defaults to True.
        skip_box_classes (Set[str]): Layout box classes to ignore. Defaults to PDF_SKIP_BOX_CLASSES.

    Returns:
        list[str]: Normalized paragraph strings extracted from the PDF.
    """
    logger.debug("Extracting layout paragraphs from PDF: %s", file_path)

    with pymupdf.open(str(file_path)) as doc:
        chunks = pymupdf4llm.to_text(
            doc,
            filename=str(file_path),
            page_chunks=True,
            header=include_headers,
            footer=include_footers,
            show_progress=False,
            force_text=True,
            use_ocr=False,
            force_ocr=False,
        )

    paragraphs: list[str] = []
    for chunk in chunks:
        page_text = chunk.get("text") or ""
        for box in chunk.get("page_boxes") or []:
            if box.get("class") in skip_box_classes:
                continue

            start, stop = box.get("pos", (0, 0))
            text = _clean_pdf_box_text(page_text[start:stop], box.get("class") or "")
            if text:
                paragraphs.append(text)

    return paragraphs


def pdf_to_text(file_path: Path | str) -> str:
    """
    Extract normalized plain text from a PDF using filtered layout boxes.

    Args:
        file_path (Path | str): Path to the PDF document.

    Returns:
        str: Cleaned textual content extracted from the PDF.
    """
    return "\n\n".join(pdf_to_paragraphs(file_path))


def get_pdf_page_count(path: Path) -> int:
    """
    Read the number of pages of a PDF document.

    Args:
        path (Path): PDF document path.

    Returns:
        int: Number of pages reported by the PDF.
    """
    with pymupdf.open(str(path)) as doc:
        return doc.page_count


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
