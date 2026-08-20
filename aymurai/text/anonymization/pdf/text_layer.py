from __future__ import annotations

from typing import Any

import pymupdf

from aymurai.logger import get_logger
from aymurai.text.anonymization.pdf.images import (
    _image_rects_for_clip,
    _is_page_background_image,
)
from aymurai.text.anonymization.pdf.redactions import _render_text_op

logger = get_logger(__name__)

# Vertical bucket size (in points) when sorting items into reading order.
_READING_ORDER_LINE_BUCKET = 3.0

_INVISIBLE_RENDER_MODE = 3


def _op_anchor_rect(op: dict[str, Any]) -> pymupdf.Rect | None:
    """
    Resolves the anchor rectangle of a rendered token operation.

    Args:
        op (dict[str, Any]): The operation dictionary being processed.

    Returns:
        pymupdf.Rect | None: The token anchor rectangle, if the op renders text.
    """
    if not op.get("text") or not op.get("fontsize"):
        return None
    rect = op.get("render_rect") or op.get("canvas_rect") or op.get("redact_rect")
    return pymupdf.Rect(rect) if rect is not None else None


def _reading_order_key(rect: pymupdf.Rect) -> tuple[float, float]:
    """
    Builds the reading-order sort key for a rectangle.

    Args:
        rect (pymupdf.Rect): The rectangle to sort.

    Returns:
        tuple[float, float]: The (line bucket, horizontal position) sort key.
    """
    center_y = (rect.y0 + rect.y1) / 2.0
    return (round(center_y / _READING_ORDER_LINE_BUCKET), rect.x0)


_INVISIBLE_FONT = pymupdf.Font("helv")


def _insert_invisible_text(page: pymupdf.Page, rect: pymupdf.Rect, text: str) -> None:
    """
    Re-inserts extracted text as an invisible run at its original position.

    The font size is fitted to the original rectangle so glyphs do not
    overshoot into neighbouring runs, and a trailing space keeps word
    boundaries explicit for text extraction.

    Args:
        page (pymupdf.Page): The PDF page being processed.
        rect (pymupdf.Rect): The original text rectangle.
        text (str): The text to re-insert.
    """
    unit_width = _INVISIBLE_FONT.text_length(text, fontsize=1.0)
    fontsize = max(min(rect.height * 0.9, rect.width / max(unit_width, 1e-3)), 1.0)
    origin = (rect.x0, rect.y1 - rect.height * 0.2)
    try:
        page.insert_text(
            origin,
            f"{text} ",
            fontname="helv",
            fontsize=fontsize,
            render_mode=_INVISIBLE_RENDER_MODE,
            overlay=True,
        )
    except Exception as exc:  # noqa: BLE001  # reason: pymupdf/third-party PDF operation may fail in undocumented ways; already logged and handled by falling back / continuing
        logger.debug("Could not re-insert text '%s': %s", text, exc)


def _merge_word_runs(
    items: list[tuple[tuple[float, float], str, Any]],
) -> list[tuple[str, Any]]:
    """
    Merges consecutive same-line words into single text runs.

    Single runs per line keep extracted lines whole (instead of one run per
    word), which makes copied text read naturally.

    Args:
        items (list[tuple[tuple[float, float], str, Any]]): The sorted layer items.

    Returns:
        list[tuple[str, Any]]: The merged (kind, payload) sequence.
    """
    merged: list[tuple[str, Any]] = []
    run_words: list[str] = []
    run_rect: pymupdf.Rect | None = None
    run_bucket: float | None = None

    def flush() -> None:
        nonlocal run_words, run_rect, run_bucket
        if run_words and run_rect is not None:
            merged.append(("text", (pymupdf.Rect(run_rect), " ".join(run_words))))
        run_words, run_rect, run_bucket = [], None, None

    for (bucket, _), kind, payload in items:
        if kind == "token":
            flush()
            merged.append((kind, payload))
            continue

        word_rect, word = payload
        if run_rect is None or bucket != run_bucket:
            flush()
            run_rect = pymupdf.Rect(word_rect)
            run_bucket = bucket
            run_words = [word]
        else:
            run_rect.include_rect(word_rect)
            run_words.append(word)

    flush()
    return merged


def _rebuild_page_text_layer(page: pymupdf.Page, token_ops: list[dict]) -> None:
    """
    Re-serializes a scan page's text layer in reading order.

    Replacement tokens are re-rendered inline between the surrounding words
    so text selection and copy/paste follow the visual reading order instead
    of trailing the page (tokens are otherwise appended after all original
    content by the redaction pipeline).

    Args:
        page (pymupdf.Page): The PDF page being processed.
        token_ops (list[dict]): The rendered token operations on the page.
    """
    anchors = [
        (rect, op) for op in token_ops if (rect := _op_anchor_rect(op)) is not None
    ]

    items: list[tuple[tuple[float, float], str, Any]] = [
        (_reading_order_key(rect), "token", (rect, op)) for rect, op in anchors
    ]

    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        word_rect = pymupdf.Rect(x0, y0, x1, y1)
        center = pymupdf.Point(
            (word_rect.x0 + word_rect.x1) / 2.0,
            (word_rect.y0 + word_rect.y1) / 2.0,
        )
        # Token glyphs are re-rendered from their ops; skip their words.
        if any(rect.contains(center) for rect, _ in anchors):
            continue
        items.append((_reading_order_key(word_rect), "word", (word_rect, word)))

    items.sort(key=lambda item: item[0])
    runs = _merge_word_runs(items)

    # Strip the whole text layer, keeping images and drawings untouched.
    page.add_redact_annot(page.rect, text=None, fill=False, cross_out=False)
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_NONE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )

    for kind, payload in runs:
        if kind == "token":
            _, op = payload
            _render_text_op(page, op)
        else:
            run_rect, run_text = payload
            _insert_invisible_text(page, run_rect, run_text)


def _rebuild_scan_text_layers(
    doc: pymupdf.Document,
    page_ops: dict[int, list[dict]],
    signature_widget_ops: dict[int, list[dict]],
) -> None:
    """
    Rebuilds the text layers of scanned pages that received redactions.

    Only pages backed by a page-sized scan image are rebuilt: their text
    layer is invisible (painted under the scan), so re-serializing it cannot
    change the page's appearance while it restores the reading order of the
    extracted text.

    Args:
        doc (pymupdf.Document): The PDF document being processed.
        page_ops (dict[int, list[dict]]): The applied page operations grouped by page index.
        signature_widget_ops (dict[int, list[dict]]): The applied signature operations grouped by page index.
    """
    token_ops_by_page: dict[int, list[dict]] = {}
    for ops_by_page in (page_ops, signature_widget_ops):
        for page_index, ops in ops_by_page.items():
            token_ops_by_page.setdefault(page_index, []).extend(ops)

    for page_index, ops in token_ops_by_page.items():
        if not ops:
            continue

        page = doc[page_index]
        image_rects = _image_rects_for_clip(page, page.rect)
        if not any(_is_page_background_image(page, rect) for rect in image_rects):
            continue

        logger.info("rebuilding text layer in reading order: page=%s", page_index)
        _rebuild_page_text_layer(page, ops)
