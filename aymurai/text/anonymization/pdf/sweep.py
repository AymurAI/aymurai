from __future__ import annotations

from typing import Any

import pymupdf

from aymurai.logger import get_logger
from aymurai.text.anonymization.alignment import (
    _label_replacement_text as _label_surface_text,
)
from aymurai.text.anonymization.pdf.common import (
    PDF_TAG_RECT_GAP_MAX,
    _group_adjacent_rects,
)
from aymurai.text.anonymization.pdf.images import (
    _entity_overlaps_image,
    _image_rects_for_clip,
    _is_page_background_image,
)
from aymurai.text.anonymization.pdf.layout import _resolve_token
from aymurai.text.anonymization.pdf.ops import _build_page_op

logger = get_logger(__name__)

# Entities shorter than this are too ambiguous to sweep for (initials,
# articles, digits) and would over-redact unrelated content.
_SWEEP_MIN_ENTITY_LENGTH = 4

# Maximum horizontal gap (in points) for a character to count as adjacent
# to a hit edge when checking word boundaries.
_SWEEP_ADJACENT_CHAR_GAP = 1.0

# A hit already covered this much by a collected redaction is a duplicate.
_SWEEP_COVERED_OVERLAP = 0.5

_SWEEP_STRIP_CHARS = " \t\r\n.,;:()[]<>\"'"


def _sweep_targets(paragraphs: list[dict]) -> list[tuple[str, dict]]:
    """
    Collects unique entity surface texts worth sweeping for.

    Args:
        paragraphs (list[dict]): The matched paragraphs with their labels.

    Returns:
        list[tuple[str, dict]]: Pairs of cleaned surface text and source label.
    """
    targets: dict[str, dict] = {}
    for paragraph in paragraphs:
        document = paragraph.get("document") or ""
        for label in paragraph.get("labels") or []:
            surface = _label_surface_text(label, document)
            surface = surface.strip(_SWEEP_STRIP_CHARS)
            if len(surface) < _SWEEP_MIN_ENTITY_LENGTH:
                continue
            key = surface.casefold()
            if key not in targets:
                targets[key] = {"surface": surface, "label": label}
    return [(entry["surface"], entry["label"]) for entry in targets.values()]


def _effective_op_rect(page: pymupdf.Page, op: dict) -> pymupdf.Rect | None:
    """
    Resolves the rectangle a page operation will actually redact.

    Asset ops targeting a page-background image only redact the entity's
    canvas rectangle (the scan itself is preserved); using their page-sized
    `redact_rect` for coverage checks would wrongly suppress the sweep for
    the whole page.

    Args:
        page (pymupdf.Page): The PDF page being processed.
        op (dict): The operation dictionary being processed.

    Returns:
        pymupdf.Rect | None: The effective redaction rectangle, if any.
    """
    asset = op.get("asset_rect") or op.get("image_rect")
    if asset is not None:
        asset_rect = pymupdf.Rect(asset)
        if not _is_page_background_image(page, asset_rect):
            return asset_rect
        rect = op.get("background_rect") or op.get("canvas_rect")
        return pymupdf.Rect(rect) if rect is not None else None
    rect = op.get("redact_rect") or op.get("canvas_rect")
    return pymupdf.Rect(rect) if rect is not None else None


# The PDF redaction subsystem passes ops/rect maps as plain dicts throughout
# (see ops.py/redactions.py); migrating it to dataclasses is tracked work.
# ast-grep-ignore: no-dict-return-annotation
def _covered_rects_by_page(
    doc: pymupdf.Document,
    page_ops: dict[int, list[dict]],
    widget_ops: dict[int, list[dict]],
    signature_widget_ops: dict[int, list[dict]],
) -> dict[int, list[pymupdf.Rect]]:
    """
    Collects the rectangles already scheduled for redaction per page.

    Args:
        doc (pymupdf.Document): The PDF document being processed.
        page_ops (dict[int, list[dict]]): The collected page operations grouped by page index.
        widget_ops (dict[int, list[dict]]): The collected text widget operations grouped by page index.
        signature_widget_ops (dict[int, list[dict]]): The collected signature operations grouped by page index.

    Returns:
        dict[int, list[pymupdf.Rect]]: The covered rectangles grouped by page index.
    """
    covered: dict[int, list[pymupdf.Rect]] = {}
    for ops_by_page in (page_ops, signature_widget_ops):
        for page_idx, ops in ops_by_page.items():
            for op in ops:
                rect = _effective_op_rect(doc[page_idx], op)
                if rect is not None:
                    covered.setdefault(page_idx, []).append(rect)
    for page_idx, ops in widget_ops.items():
        for op in ops:
            widget_info = op.get("widget_info") or {}
            rect = widget_info.get("rect")
            if rect is not None:
                covered.setdefault(page_idx, []).append(pymupdf.Rect(rect))
    return covered


def _is_covered(rect: pymupdf.Rect, covered: list[pymupdf.Rect]) -> bool:
    """
    Checks whether a hit rectangle is already scheduled for redaction.

    Args:
        rect (pymupdf.Rect): The candidate hit rectangle.
        covered (list[pymupdf.Rect]): The rectangles already scheduled on the page.

    Returns:
        bool: True when the hit substantially overlaps a scheduled rectangle.
    """
    area = rect.get_area()
    if area <= 0:
        return True
    for existing in covered:
        overlap = (rect & existing).get_area()
        if overlap / area >= _SWEEP_COVERED_OVERLAP:
            return True
    return False


def _page_chars(page: pymupdf.Page) -> list[tuple[pymupdf.Rect, str]]:
    """
    Extracts per-character rectangles from a page.

    Args:
        page (pymupdf.Page): The PDF page being processed.

    Returns:
        list[tuple[pymupdf.Rect, str]]: Character rectangles with their text.
    """
    chars: list[tuple[pymupdf.Rect, str]] = []
    raw = page.get_text("rawdict")
    for block in raw.get("blocks") or []:
        for line in block.get("lines") or []:
            for span in line.get("spans") or []:
                for char in span.get("chars") or []:
                    bbox = char.get("bbox")
                    text = char.get("c") or ""
                    if bbox is not None and text:
                        chars.append((pymupdf.Rect(bbox), text))
    return chars


def _hit_covers_whole_words(
    chars: list[tuple[pymupdf.Rect, str]],
    rect: pymupdf.Rect,
) -> bool:
    """
    Checks that a search hit does not cut through a larger word.

    Prevents sweeping a surface like "Rios" out of "barrios": the characters
    immediately adjacent to the hit's horizontal edges must not be
    alphanumeric. Adjacent punctuation (e.g. "PEREZ.") is fine.

    Args:
        chars (list[tuple[pymupdf.Rect, str]]): The page characters with their rectangles.
        rect (pymupdf.Rect): The candidate hit rectangle.

    Returns:
        bool: True when the hit is bounded by non-alphanumeric neighbours.
    """
    gap = _SWEEP_ADJACENT_CHAR_GAP
    for char_rect, char_text in chars:
        vertical_overlap = min(char_rect.y1, rect.y1) - max(char_rect.y0, rect.y0)
        if vertical_overlap <= char_rect.height * 0.5:
            continue
        center = (char_rect.x0 + char_rect.x1) / 2.0
        adjacent_left = center < rect.x0 and char_rect.x1 > rect.x0 - gap
        adjacent_right = center > rect.x1 and char_rect.x0 < rect.x1 + gap
        if (adjacent_left or adjacent_right) and char_text.isalnum():
            return False
    return True


# ast-grep-ignore: no-dict-return-annotation
def _collect_sweep_redactions(
    doc: pymupdf.Document,
    paragraphs: list[dict],
    render_context: dict[str, Any] | None,
    page_ops: dict[int, list[dict]],
    widget_ops: dict[int, list[dict]],
    signature_widget_ops: dict[int, list[dict]],
) -> dict[int, list[dict]]:
    """
    Sweeps the whole document for residual occurrences of anonymized entities.

    The NER model labels specific mentions; repeated or differently-cased
    occurrences it missed would otherwise survive in the exported text layer
    and scan pixels. Every labeled surface is searched case-insensitively on
    every page and residual hits are scheduled for redaction with the same
    replacement token.

    Args:
        doc (pymupdf.Document): The PDF document being processed.
        paragraphs (list[dict]): The matched paragraphs with their labels.
        render_context (dict[str, Any] | None): The rendering context used to resolve replacement tokens.
        page_ops (dict[int, list[dict]]): The collected page operations grouped by page index.
        widget_ops (dict[int, list[dict]]): The collected text widget operations grouped by page index.
        signature_widget_ops (dict[int, list[dict]]): The collected signature operations grouped by page index.

    Returns:
        dict[int, list[dict]]: Additional sweep operations grouped by page index.
    """
    targets = _sweep_targets(paragraphs)
    if not targets:
        # ast-grep-ignore: no-dict-literal-return
        return {}

    covered_by_page = _covered_rects_by_page(
        doc, page_ops, widget_ops, signature_widget_ops
    )
    sweep_ops: dict[int, list[dict]] = {}

    for page_index in range(len(doc)):
        page = doc[page_index]
        covered = covered_by_page.get(page_index, [])
        image_rects = _image_rects_for_clip(page, page.rect)
        chars: list[tuple[pymupdf.Rect, str]] | None = None

        for surface, label in targets:
            hits = page.search_for(surface)
            if not hits:
                continue

            if chars is None:
                chars = _page_chars(page)

            token = _resolve_token(label, render_context)
            for rect in _group_adjacent_rects(hits, max_gap=PDF_TAG_RECT_GAP_MAX):
                if _is_covered(rect, covered):
                    continue
                if not _hit_covers_whole_words(chars, rect):
                    continue

                img_rect = _entity_overlaps_image(page, rect, image_rects)
                op = _build_page_op(
                    rect,
                    None,
                    token,
                    is_image=(img_rect is not None),
                )
                if img_rect is not None:
                    op["image_rect"] = img_rect
                sweep_ops.setdefault(page_index, []).append(op)
                covered.append(pymupdf.Rect(rect))
                logger.info(
                    "sweep: residual '%s' on page %s -> %s",
                    surface,
                    page_index,
                    token,
                )
            covered_by_page[page_index] = covered

    return sweep_ops
