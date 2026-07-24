from __future__ import annotations

import pymupdf

from aymurai.text.anonymization.pdf.common import _rect_vertical_overlap

_IMAGE_OVERLAP_THRESHOLD = 0.3

# Minimum fraction of the page area an image must cover to be treated as a
# scanned-page background (e.g. the page scan of an OCR'd document) instead of
# a removable embedded asset (photo, logo, signature scan).
_PAGE_BACKGROUND_MIN_COVERAGE = 0.8


def _image_rects_for_clip(
    page: pymupdf.Page,
    clip: pymupdf.Rect,
) -> list[pymupdf.Rect]:
    """
    Collects image rectangles that overlap the given page region.

    Args:
        page (pymupdf.Page): The PDF page being processed.
        clip (pymupdf.Rect): The clipping rectangle to constrain the operation.

    Returns:
        list[pymupdf.Rect]: The image rectangles that overlap the clip region.
    """
    rects: list[pymupdf.Rect] = []
    for img_info in page.get_image_info():
        bbox = img_info.get("bbox")
        if bbox is None:
            continue
        img_rect = pymupdf.Rect(bbox)
        if img_rect.intersects(clip) and img_rect.get_area() > 0:
            rects.append(img_rect)
    return rects


def _entity_overlaps_image(
    page: pymupdf.Page,
    entity_rect: pymupdf.Rect,
    image_rects: list[pymupdf.Rect],
) -> pymupdf.Rect | None:
    """
    Checks whether an entity rectangle overlaps a detected image.

    Args:
        page (pymupdf.Page): The PDF page being processed.
        entity_rect (pymupdf.Rect): The rectangle representing the entity on the page.
        image_rects (list[pymupdf.Rect]): The image rectangles available for overlap checks.

    Returns:
        pymupdf.Rect | None: The overlapping image rectangle, if one exists.
    """
    for img_rect in image_rects:
        overlap = _rect_vertical_overlap(entity_rect, img_rect)
        if overlap >= _IMAGE_OVERLAP_THRESHOLD and entity_rect.intersects(img_rect):
            return img_rect
    return None


def _is_page_background_image(
    page: pymupdf.Page,
    image_rect: pymupdf.Rect,
) -> bool:
    """
    Checks whether an image rectangle behaves as a scanned-page background.

    Scanned (OCR'd) PDFs paint a page-sized scan image over an extracted text
    layer. Such images must never be removed wholesale: doing so wipes the
    visible content of the entire page.

    Args:
        page (pymupdf.Page): The PDF page being processed.
        image_rect (pymupdf.Rect): The image rectangle to classify.

    Returns:
        bool: True when the image covers enough of the page to be a background.
    """
    page_area = page.rect.get_area()
    if page_area <= 0:
        return False
    coverage = (image_rect & page.rect).get_area() / page_area
    return coverage >= _PAGE_BACKGROUND_MIN_COVERAGE


def _try_image_entity(
    page: pymupdf.Page,
    clip: pymupdf.Rect,
    image_rects: list[pymupdf.Rect],
) -> pymupdf.Rect | None:
    """
    Finds the best image rectangle for an entity when text search fails.

    Page-background images (the scan layer of OCR'd documents) are never
    candidates: matching one would schedule the removal of the entire page
    content instead of a single embedded asset.

    Args:
        page (pymupdf.Page): The PDF page being processed.
        clip (pymupdf.Rect): The clipping rectangle to constrain the operation.
        image_rects (list[pymupdf.Rect]): The image rectangles available for overlap checks.

    Returns:
        pymupdf.Rect | None: The best image rectangle for the entity, if found.
    """
    if not image_rects:
        return None

    # Pick the image whose intersection with *clip* is largest
    best: pymupdf.Rect | None = None
    best_area = 0.0
    for img_rect in image_rects:
        if _is_page_background_image(page, img_rect):
            continue
        if not img_rect.intersects(clip) or img_rect.get_area() <= 0:
            continue
        intersection = img_rect & clip
        area = intersection.get_area()
        if area > best_area:
            best_area = area
            best = img_rect

    return best
