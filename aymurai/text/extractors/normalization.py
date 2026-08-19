import unicodedata


def normalize_text(text: str) -> str:
    """
    Normalize Unicode output consistently across extractors.

    Args:
        text (str): Raw text extracted from a document.

    Returns:
        str: Normalized string in NFKC form.
    """
    return unicodedata.normalize("NFKC", text)
