from __future__ import annotations

from typing import Any

import pymupdf

from aymurai.logger import get_logger
from aymurai.text.anonymization.alignment import (
    _label_replacement_start as _label_start,
)
from aymurai.text.anonymization.alignment import (
    _label_replacement_text as _label_surface_text,
)
from aymurai.text.anonymization.pdf.common import (
    PDF_TAG_RECT_GAP_MAX,
    PDF_TAG_RECT_INSET,
    PDF_TAG_RECT_X_PADDING,
    PDF_TAG_RECT_Y_PADDING,
    _base14_fontname_for_style,
    _default_style,
    _entity_style_from_spans,
    _find_flexible,
    _fit_display_token,
    _get_base14_font,
    _group_adjacent_rects,
)
from aymurai.text.anonymization.pdf.images import (
    _entity_overlaps_image,
    _image_rects_for_clip,
    _try_image_entity,
)
from aymurai.text.anonymization.pdf.layout import (
    _find_line_char_span,
    _line_chars_from_page,
    _line_chars_text,
    _pick_rect_group_for_segment,
    _rect_from_char_slice,
    _resolve_token,
)
from aymurai.text.anonymization.pdf.widgets import (
    _entity_overlaps_widget,
    _page_widget_infos,
)

logger = get_logger(__name__)


def _padded_rect(rect: pymupdf.Rect, clip: pymupdf.Rect) -> pymupdf.Rect:
    """
    Pads a rectangle within the provided clipping bounds.

    Args:
        rect (pymupdf.Rect): The rectangle used by the helper.
        clip (pymupdf.Rect): The clipping rectangle to constrain the operation.

    Returns:
        pymupdf.Rect: The padded rectangle clipped to the provided bounds.
    """
    padded = pymupdf.Rect(rect)
    padded.x0 = max(clip.x0, padded.x0 - PDF_TAG_RECT_X_PADDING)
    padded.y0 = max(clip.y0, padded.y0 - PDF_TAG_RECT_Y_PADDING)
    padded.x1 = min(clip.x1, padded.x1 + PDF_TAG_RECT_X_PADDING)
    padded.y1 = min(clip.y1, padded.y1 + PDF_TAG_RECT_Y_PADDING)
    return padded


def _render_rect(rect: pymupdf.Rect) -> pymupdf.Rect:
    """
    Builds the token rendering rectangle from the padded canvas rectangle.

    Args:
        rect (pymupdf.Rect): The rectangle used by the helper.

    Returns:
        pymupdf.Rect: The rectangle used to render the replacement token.
    """
    render_rect = pymupdf.Rect(rect)
    inset = min(PDF_TAG_RECT_INSET, max(render_rect.height * 0.1, 0.0))
    render_rect.x0 += inset
    render_rect.x1 -= inset
    if render_rect.x1 <= render_rect.x0:
        render_rect = pymupdf.Rect(rect)
    return render_rect


def _text_redact_rect(rect: pymupdf.Rect) -> pymupdf.Rect:
    """
    Builds the redaction rectangle used to remove original text.

    Args:
        rect (pymupdf.Rect): The rectangle used by the helper.

    Returns:
        pymupdf.Rect: The rectangle used for text redaction.
    """
    redact_rect = pymupdf.Rect(rect)
    edge_inset = min(0.25, max(redact_rect.width * 0.01, 0.05))
    if redact_rect.width > (2 * edge_inset):
        redact_rect.x0 += edge_inset
        redact_rect.x1 -= edge_inset
    return redact_rect


def _build_page_op(
    rect: pymupdf.Rect,
    line: dict | None,
    token: str,
    is_image: bool = False,
    entity_style: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Builds the rendering operation metadata for a matched page segment.

    Args:
        rect (pymupdf.Rect): The rectangle used by the helper.
        line (dict | None): The parsed line metadata being processed.
        token (str): The logical replacement token being processed.
        is_image (bool, optional): Whether the operation is intended for image-backed content. Defaults to False.
        entity_style (dict[str, Any] | None, optional): The resolved style dictionary for the entity text. Defaults to None.

    Returns:
        dict[str, Any]: The rendering operation metadata for the segment.
    """
    line_clip = pymupdf.Rect(line["bbox"]) if line else pymupdf.Rect(rect)
    canvas_rect = _padded_rect(rect, line_clip)
    render_rect = _render_rect(canvas_rect)
    style = entity_style or (line or {}).get("style") or _default_style()
    base_font_size = float((line or {}).get("font_size") or style.get("size") or 10.0)

    # Always use Base-14 fonts: they carry correct bold/italic weight and
    # contain all glyphs needed for tags (<, >, _, digits, letters).
    # Subset font buffers extracted from the PDF lack many of these glyphs.
    fontname = _base14_fontname_for_style(style)
    font_obj = _get_base14_font(style)

    display_token, fitted_size = _fit_display_token(
        token,
        render_rect,
        fontname,
        base_font_size,
        font_obj=font_obj,
    )

    if not display_token or fitted_size is None:
        logger.warning(
            "Could not fit PDF token '%s' inside rect=%s",
            token,
            tuple(round(value, 2) for value in canvas_rect),
        )

    return {
        "redact_rect": _text_redact_rect(rect),
        "background_rect": canvas_rect,
        "canvas_rect": canvas_rect,
        "render_rect": render_rect,
        "line_rect": line_clip,
        "text": display_token,
        "logical_token": token,
        "fontname": fontname,
        "fontsize": fitted_size,
        "text_align": pymupdf.TEXT_ALIGN_LEFT,
        "text_color": style.get("color") or (0.0, 0.0, 0.0),
        "style": style,
    }


def _squared_distance_between_rect_centers(
    left: pymupdf.Rect,
    right: pymupdf.Rect,
) -> float:
    """
    Computes the squared distance between two rectangle centers.

    Args:
        left (pymupdf.Rect): The first rectangle.
        right (pymupdf.Rect): The second rectangle.

    Returns:
        float: The squared distance between rectangle centers.
    """
    left_center = ((left.x0 + left.x1) / 2.0, (left.y0 + left.y1) / 2.0)
    right_center = ((right.x0 + right.x1) / 2.0, (right.y0 + right.y1) / 2.0)
    return (left_center[0] - right_center[0]) ** 2 + (
        left_center[1] - right_center[1]
    ) ** 2


def _refine_signature_text_rect(
    page: pymupdf.Page,
    entity_text: str,
    widget_rect: pymupdf.Rect,
    current_rect: pymupdf.Rect,
) -> pymupdf.Rect:
    """
    Finds a tighter text rectangle for signer names inside signature widgets.

    Args:
        page (pymupdf.Page): The PDF page being processed.
        entity_text (str): The entity text being mapped.
        widget_rect (pymupdf.Rect): The signature widget rectangle.
        current_rect (pymupdf.Rect): The currently resolved entity rectangle.

    Returns:
        pymupdf.Rect: The refined rectangle when available, otherwise current_rect.
    """
    widget_clip = pymupdf.Rect(widget_rect)
    hits = [
        pymupdf.Rect(hit)
        for hit in page.search_for(entity_text, clip=widget_clip)
        if pymupdf.Rect(hit).intersects(widget_clip)
    ]
    if not hits:
        return pymupdf.Rect(current_rect)

    target = pymupdf.Rect(current_rect)
    intersecting_hits = [hit for hit in hits if hit.intersects(target)]
    candidates = intersecting_hits or hits
    return pymupdf.Rect(
        min(
            candidates,
            key=lambda hit: _squared_distance_between_rect_centers(hit, target),
        )
    )


def _build_signature_page_op(
    page: pymupdf.Page,
    entity_text: str,
    widget_info: dict[str, Any],
    current_rect: pymupdf.Rect,
    token: str,
    entity_style: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Builds a signature-specific operation scoped to the sensitive text only.

    Args:
        page (pymupdf.Page): The PDF page being processed.
        entity_text (str): The sensitive text being replaced.
        widget_info (dict[str, Any]): The signature widget metadata.
        current_rect (pymupdf.Rect): The initially resolved text rectangle.
        token (str): The logical replacement token.
        entity_style (dict[str, Any] | None): The text style to render with.

    Returns:
        dict[str, Any]: The signature replacement operation.
    """
    refined_rect = _refine_signature_text_rect(
        page,
        entity_text,
        widget_info["rect"],
        current_rect,
    )
    op = _build_page_op(
        refined_rect,
        None,
        token,
        entity_style=entity_style or widget_info.get("style") or None,
    )
    op["widget_xref"] = widget_info["xref"]
    op["widget_rect"] = widget_info["rect"]
    return op


def _collect_page_redactions(
    doc: pymupdf.Document,
    paragraphs: list[dict],
    render_context: dict[str, Any] | None,
) -> dict[int, list[dict]]:
    """
    Collects text, widget, and signature redaction operations for a document.

    Args:
        doc (pymupdf.Document): The PDF document being processed.
        paragraphs (list[dict]): The paragraph collection being processed.
        render_context (dict[str, Any] | None): The rendering context used to resolve replacement tokens.

    Returns:
        tuple[dict[int, list[dict]], dict[int, list[dict]], dict[int, list[dict]]]: The page, text-widget, and signature-widget operations.
    """
    page_ops: dict[int, list[dict]] = {}
    widget_ops: dict[int, list[dict]] = {}
    signature_widget_ops: dict[int, list[dict]] = {}
    line_x_cursor: dict[tuple[int, int, int], float] = {}
    line_char_cache: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
    line_char_text_cache: dict[tuple[int, int, int], str] = {}
    line_char_cursor: dict[tuple[int, int, int], int] = {}

    # Pre-compute image rects and widgets per page
    page_image_rects: dict[int, list[pymupdf.Rect]] = {}
    page_widgets: dict[int, list[dict[str, Any]]] = {}

    for paragraph in paragraphs:
        metadata = paragraph.get("metadata") or {}
        lines = metadata.get("lines") or []
        if not lines:
            continue

        page_index = int(metadata["page_index"])
        page = doc[page_index]
        line_text = metadata.get("line_text") or ""
        box_clip = pymupdf.Rect(metadata.get("box_bbox") or page.rect)
        document = paragraph.get("document") or ""
        labels = sorted(paragraph.get("labels") or [], key=_label_start)
        search_cursor = 0

        # Lazy-load image rects and widget infos for this page
        if page_index not in page_image_rects:
            page_image_rects[page_index] = _image_rects_for_clip(page, page.rect)
        if page_index not in page_widgets:
            page_widgets[page_index] = _page_widget_infos(page)

        for label in labels:
            entity_text = _label_surface_text(label, document).strip()
            if not entity_text:
                continue

            token = _resolve_token(label, render_context)

            span = _find_flexible(line_text, entity_text, start=search_cursor)
            if span is None:
                span = _find_flexible(line_text, entity_text, start=0)
            if span is None:
                # -- Fallback: direct page search --
                fallback_rects = [
                    rect
                    for rect in page.search_for(entity_text, clip=box_clip)
                    if rect.intersects(box_clip)
                ]

                # The matched layout paragraph may be wrong (e.g. CER match
                # against re-split table text): retry without the box clip
                # so real text hits are redacted where they actually are.
                if not fallback_rects:
                    fallback_rects = page.search_for(entity_text)

                # Check if this is a widget-backed entity before falling back to images
                if fallback_rects:
                    fallback_widget = _entity_overlaps_widget(
                        fallback_rects[0],
                        page_widgets[page_index],
                    )
                    if fallback_widget is not None:
                        if (
                            fallback_widget["field_type"]
                            == pymupdf.PDF_WIDGET_TYPE_TEXT
                        ):
                            widget_ops.setdefault(page_index, []).append(
                                {
                                    "widget_xref": fallback_widget["xref"],
                                    "field_name": fallback_widget["field_name"],
                                    "widget_info": fallback_widget,
                                    "entity_text": entity_text,
                                    "logical_token": token,
                                }
                            )
                            continue
                        if (
                            fallback_widget["field_type"]
                            == pymupdf.PDF_WIDGET_TYPE_SIGNATURE
                        ):
                            op = _build_signature_page_op(
                                page,
                                entity_text,
                                fallback_widget,
                                fallback_rects[0],
                                token,
                                entity_style=fallback_widget.get("style") or None,
                            )
                            signature_widget_ops.setdefault(page_index, []).append(op)
                            continue

                # Check if this is an image-based entity
                if not fallback_rects:
                    img_match = _try_image_entity(
                        page,
                        box_clip,
                        page_image_rects[page_index],
                    )
                    if img_match is not None:
                        op = _build_page_op(
                            img_match,
                            lines[0] if lines else None,
                            token,
                            is_image=True,
                        )
                        op["image_rect"] = img_match
                        page_ops.setdefault(page_index, []).append(op)
                        continue

                if fallback_rects:
                    grouped_rects = _group_adjacent_rects(
                        fallback_rects, max_gap=PDF_TAG_RECT_GAP_MAX
                    )
                    fallback_line = lines[0] if lines else None

                    # Check if any of these rects overlap an image
                    for rect in grouped_rects:
                        img_rect = _entity_overlaps_image(
                            page,
                            rect,
                            page_image_rects[page_index],
                        )
                        op = _build_page_op(
                            rect,
                            fallback_line,
                            token,
                            is_image=(img_rect is not None),
                        )
                        if img_rect is not None:
                            op["image_rect"] = img_rect
                        page_ops.setdefault(page_index, []).append(op)
                    continue

                logger.warning(
                    "Could not map label '%s' on page=%s box=%s",
                    entity_text,
                    metadata.get("page_number"),
                    metadata.get("box_index"),
                )
                continue

            search_cursor = span[1]

            # Collect line segments this entity spans
            segments: list[
                tuple[
                    dict,
                    str,
                    pymupdf.Rect,
                    pymupdf.Rect | None,
                    dict,
                    dict[str, Any] | None,
                ]
            ] = []
            for line in lines:
                overlap_start = max(span[0], line["start"])
                overlap_end = min(span[1], line["end"])
                if overlap_end <= overlap_start:
                    continue

                segment_text = line_text[overlap_start:overlap_end].strip()
                if not segment_text:
                    continue

                line_key = (
                    line["page_index"],
                    line["box_index"],
                    line["line_index"],
                )
                line_chars = line_char_cache.get(line_key)
                if line_chars is None:
                    line_chars = _line_chars_from_page(page, line)
                    line_char_cache[line_key] = line_chars

                line_char_text = line_char_text_cache.get(line_key)
                if line_char_text is None:
                    line_char_text = _line_chars_text(line_chars)
                    line_char_text_cache[line_key] = line_char_text

                raw_span = _find_line_char_span(
                    line_chars,
                    segment_text,
                    start=line_char_cursor.get(line_key, 0),
                    raw_text=line_char_text,
                )
                rect = None
                if raw_span is not None:
                    line_char_cursor[line_key] = raw_span[1]
                    rect = _rect_from_char_slice(line_chars, raw_span[0], raw_span[1])

                if rect is None:
                    raw_start = (
                        overlap_start - line["start"] + int(line.get("strip_offset", 0))
                    )
                    raw_end = (
                        overlap_end - line["start"] + int(line.get("strip_offset", 0))
                    )
                    rect = _rect_from_char_slice(line_chars, raw_start, raw_end)
                if rect is None:
                    rect = _pick_rect_group_for_segment(
                        page,
                        line,
                        segment_text,
                        line_x_cursor,
                    )

                widget_info = _entity_overlaps_widget(
                    rect,
                    page_widgets[page_index],
                )

                # Check for image overlap
                img_rect = _entity_overlaps_image(
                    page,
                    rect,
                    page_image_rects[page_index],
                )

                # Determine entity-specific style from the span that
                # actually contains this text (not the line's dominant style)
                offset_in_line = overlap_start - line["start"]
                ent_style = _entity_style_from_spans(line, offset_in_line)

                segments.append(
                    (line, segment_text, rect, img_rect, ent_style, widget_info)
                )

            if not segments:
                continue

            if len(segments) == 1:
                # Single-line entity: route widget-backed content through the widget path.
                line, _seg_text, rect, img_rect, ent_style, widget_info = segments[0]
                if widget_info is not None:
                    if widget_info["field_type"] == pymupdf.PDF_WIDGET_TYPE_TEXT:
                        widget_ops.setdefault(page_index, []).append(
                            {
                                "widget_xref": widget_info["xref"],
                                "field_name": widget_info["field_name"],
                                "widget_info": widget_info,
                                "entity_text": entity_text,
                                "logical_token": token,
                            }
                        )
                        continue
                    if widget_info["field_type"] == pymupdf.PDF_WIDGET_TYPE_SIGNATURE:
                        op = _build_signature_page_op(
                            page,
                            entity_text,
                            widget_info,
                            rect,
                            token,
                            entity_style=ent_style,
                        )
                        signature_widget_ops.setdefault(page_index, []).append(op)
                        continue

                op = _build_page_op(
                    rect,
                    line,
                    token,
                    is_image=(img_rect is not None),
                    entity_style=ent_style,
                )
                if img_rect is not None:
                    op["image_rect"] = img_rect
                page_ops.setdefault(page_index, []).append(op)
            else:
                # Multi-line entity: write the token on the widest segment only; blank the others.
                widest_idx = max(
                    range(len(segments)),
                    key=lambda i: segments[i][2].width,
                )
                any_image = any(seg[3] is not None for seg in segments)
                shared_image_rect = next(
                    (seg[3] for seg in segments if seg[3] is not None),
                    None,
                )

                signature_widget = None
                if all(seg[5] is not None for seg in segments):
                    widget_xrefs = {int(seg[5]["xref"]) for seg in segments}
                    widget_types = {int(seg[5]["field_type"]) for seg in segments}
                    if len(widget_xrefs) == 1 and widget_types == {
                        pymupdf.PDF_WIDGET_TYPE_SIGNATURE
                    }:
                        signature_widget = segments[0][5]

                for seg_idx, (
                    seg_line,
                    seg_text,
                    seg_rect,
                    seg_img,
                    seg_style,
                    seg_widget,
                ) in enumerate(segments):
                    if signature_widget is not None:
                        op = _build_signature_page_op(
                            page,
                            seg_text,
                            signature_widget,
                            seg_rect,
                            token,
                            entity_style=seg_style,
                        )
                        if seg_idx != widest_idx:
                            op["text"] = None
                            op["fontsize"] = None
                        signature_widget_ops.setdefault(page_index, []).append(op)
                        continue

                    if seg_idx == widest_idx:
                        op = _build_page_op(
                            seg_rect,
                            seg_line,
                            token,
                            is_image=any_image,
                            entity_style=seg_style,
                        )
                        if shared_image_rect is not None:
                            op["image_rect"] = shared_image_rect
                    else:
                        op = _build_page_op(
                            seg_rect,
                            seg_line,
                            token,
                            is_image=(seg_img is not None),
                            entity_style=seg_style,
                        )
                        op["text"] = None
                        op["fontsize"] = None
                        if seg_img is not None:
                            op["image_rect"] = seg_img

                    page_ops.setdefault(page_index, []).append(op)

    return page_ops, widget_ops, signature_widget_ops
