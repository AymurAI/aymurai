from __future__ import annotations

from typing import Any

import pymupdf

from aymurai.logger import get_logger
from aymurai.text.anonymization.pdf.common import (
    _base14_fontname_for_style,
    _get_base14_font,
)
from aymurai.text.anonymization.pdf.images import _is_page_background_image
from aymurai.text.anonymization.pdf.widgets import (
    _apply_widget_ops,
    _prepare_signature_widget_ops,
)

logger = get_logger(__name__)


def _render_text_op(page: pymupdf.Page, op: dict) -> None:
    """
    Renders a single anonymization token back onto a page.

    Args:
        page (pymupdf.Page): The PDF page being processed.
        op (dict): The operation dictionary being processed.
    """
    canvas = pymupdf.Rect(op.get("background_rect") or op["canvas_rect"])
    if not op.get("skip_background_fill"):
        page.draw_rect(
            canvas,
            color=(1, 1, 1),
            fill=(1, 1, 1),
            width=0,
            overlay=True,
        )

    if not op.get("text") or not op.get("fontsize"):
        return

    render = op["render_rect"]
    line_rect = pymupdf.Rect(op.get("line_rect") or render)
    style = op.get("style") or {}
    base14_name = _base14_fontname_for_style(style)
    font_obj = _get_base14_font(style)

    fontsize = float(op["fontsize"])
    descender = float(style.get("descender") or -0.2)
    baseline_y = line_rect.y1 + (descender * fontsize)
    baseline_y = min(
        max(baseline_y, line_rect.y0 + (fontsize * 0.65)),
        line_rect.y1 - 0.1,
    )

    text_width = font_obj.text_length(op["text"], fontsize=fontsize)
    x_start = render.x0 + max((render.width - text_width) / 2.0, 0.0)

    try:
        page.insert_text(
            (x_start, baseline_y),
            op["text"],
            fontname=base14_name,
            fontsize=fontsize,
            color=op["text_color"],
            overlay=True,
        )
        return
    except Exception as exc:
        logger.debug("insert_text failed for '%s': %s", op["text"], exc)

    try:
        tw = pymupdf.TextWriter(page.rect, color=op["text_color"])
        tw.fill_textbox(
            render,
            op["text"],
            font=font_obj,
            fontsize=fontsize,
            align=op.get("text_align", pymupdf.TEXT_ALIGN_CENTER),
        )
        tw.write_text(page, overlay=True)
        return
    except Exception as exc:
        logger.debug("TextWriter failed for '%s': %s", op["text"], exc)

    try:
        page.insert_textbox(
            render,
            op["text"],
            fontname=base14_name,
            fontsize=fontsize,
            color=op["text_color"],
            align=op.get("text_align", pymupdf.TEXT_ALIGN_CENTER),
            overlay=True,
        )
    except Exception as exc:
        logger.warning(
            "All text insertion methods failed for '%s': %s",
            op["text"],
            exc,
        )


def _page_asset_rect(op: dict[str, Any]) -> pymupdf.Rect | None:
    """
    Resolves the asset rectangle associated with a page operation.

    Args:
        op (dict[str, Any]): The operation dictionary being processed.

    Returns:
        pymupdf.Rect | None: The asset rectangle associated with the operation, if any.
    """
    asset_rect = op.get("asset_rect") or op.get("image_rect")
    if asset_rect is None:
        return None
    return pymupdf.Rect(asset_rect)


def _partition_page_ops(
    page_ops: dict[int, list[dict]],
) -> tuple[dict[int, list[dict]], dict[int, list[dict]]]:
    """
    Splits page operations into text-only and asset-backed groups.

    Args:
        page_ops (dict[int, list[dict]]): The collected page operations grouped by page index.

    Returns:
        tuple[dict[int, list[dict]], dict[int, list[dict]]]: The text-only and asset-backed operations.
    """
    text_ops: dict[int, list[dict]] = {}
    asset_ops: dict[int, list[dict]] = {}

    for page_idx, ops in page_ops.items():
        for op in ops:
            if _page_asset_rect(op) is None:
                text_ops.setdefault(page_idx, []).append(op)
            else:
                asset_ops.setdefault(page_idx, []).append(op)

    return text_ops, asset_ops


def _apply_text_redactions(
    doc: pymupdf.Document,
    text_page_ops: dict[int, list[dict]],
) -> None:
    """
    Applies text-only redactions and re-renders replacement tokens.

    Args:
        doc (pymupdf.Document): The PDF document being processed.
        text_page_ops (dict[int, list[dict]]): The text-only page operations grouped by page index.
    """
    for page_idx, ops in text_page_ops.items():
        if not ops:
            continue

        page = doc[page_idx]
        for op in ops:
            page.add_redact_annot(
                op["redact_rect"],
                text=None,
                fill=(1, 1, 1),
                cross_out=False,
            )

        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
            text=pymupdf.PDF_REDACT_TEXT_REMOVE,
        )

        for op in ops:
            _render_text_op(page, op)


def _background_redact_rect(op: dict[str, Any]) -> pymupdf.Rect:
    """
    Resolves the redaction rectangle for an entity over a page background image.

    Uses the padded canvas rectangle so the scanned pixels of the full glyphs
    are destroyed, falling back to the plain text redaction rectangle.

    Args:
        op (dict[str, Any]): The operation dictionary being processed.

    Returns:
        pymupdf.Rect: The rectangle to redact inside the background image.
    """
    rect = op.get("background_rect") or op.get("canvas_rect") or op["redact_rect"]
    return pymupdf.Rect(rect)


def _apply_asset_redactions(
    doc: pymupdf.Document,
    asset_page_ops: dict[int, list[dict]],
) -> None:
    """
    Applies asset-backed redactions and re-renders replacement tokens.

    Small embedded assets (photos, logos, signature scans) are removed
    wholesale. Page-sized background images (the scan layer of OCR'd
    documents) are preserved: only the entity pixels inside them are erased,
    together with the OCR text underneath, so the rest of the page content
    survives.

    Args:
        doc (pymupdf.Document): The PDF document being processed.
        asset_page_ops (dict[int, list[dict]]): The asset-backed page operations grouped by page index.
    """
    for page_idx, ops in asset_page_ops.items():
        if not ops:
            continue

        page = doc[page_idx]
        removable_ops: list[tuple[dict, pymupdf.Rect]] = []
        background_ops: list[dict] = []
        for op in ops:
            asset_rect = _page_asset_rect(op)
            if asset_rect is None:
                continue
            if _is_page_background_image(page, asset_rect):
                background_ops.append(op)
            else:
                removable_ops.append((op, asset_rect))

        if removable_ops:
            graphics_mode = pymupdf.PDF_REDACT_LINE_ART_NONE
            for op, asset_rect in removable_ops:
                page.add_redact_annot(
                    asset_rect,
                    text=None,
                    fill=(1, 1, 1),
                    cross_out=False,
                )
                graphics_mode = max(
                    graphics_mode,
                    int(op.get("graphics_mode") or pymupdf.PDF_REDACT_LINE_ART_NONE),
                )

            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_REMOVE,
                graphics=graphics_mode,
                text=pymupdf.PDF_REDACT_TEXT_REMOVE,
            )

        if background_ops:
            for op in background_ops:
                page.add_redact_annot(
                    _background_redact_rect(op),
                    text=None,
                    fill=(1, 1, 1),
                    cross_out=False,
                )

            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
                graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                text=pymupdf.PDF_REDACT_TEXT_REMOVE,
            )

        for op in [pair[0] for pair in removable_ops] + background_ops:
            _render_text_op(page, op)


def _apply_signature_redactions(
    doc: pymupdf.Document,
    signature_widget_ops: dict[int, list[dict]],
) -> None:
    """
    Applies signer-name redactions without removing the full signature appearance.

    Args:
        doc (pymupdf.Document): The PDF document being processed.
        signature_widget_ops (dict[int, list[dict]]): The signature operations grouped by page index.
    """
    for page_idx, ops in signature_widget_ops.items():
        if not ops:
            continue

        page = doc[page_idx]
        for op in ops:
            page.add_redact_annot(
                op["redact_rect"],
                text=None,
                fill=(1, 1, 1),
                cross_out=False,
            )

        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
            graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
            text=pymupdf.PDF_REDACT_TEXT_REMOVE,
        )

        for op in ops:
            _render_text_op(page, op)


def _apply_redactions(
    doc: pymupdf.Document,
    page_ops: dict[int, list[dict]],
    widget_ops: dict[int, list[dict]],
    signature_widget_ops: dict[int, list[dict]],
) -> None:
    """
    Applies all collected PDF redactions in the correct order.

    Args:
        doc (pymupdf.Document): The PDF document being processed.
        page_ops (dict[int, list[dict]]): The collected page operations grouped by page index.
        widget_ops (dict[int, list[dict]]): The collected text widget operations grouped by page index.
        signature_widget_ops (dict[int, list[dict]]): The collected signature widget operations grouped by page index.
    """
    _apply_widget_ops(doc, widget_ops)
    _prepare_signature_widget_ops(doc, signature_widget_ops)

    text_page_ops, asset_page_ops = _partition_page_ops(page_ops)

    _apply_text_redactions(doc, text_page_ops)
    _apply_asset_redactions(doc, asset_page_ops)
    _apply_signature_redactions(doc, signature_widget_ops)
