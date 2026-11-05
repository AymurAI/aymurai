import unicodedata


def normalize_text(value: str | None) -> str:
    """
    Lowercase + strip accents, so text matching ignores casing/tildes.

    Args:
        value (str | None): Text to normalize.

    Returns:
        str: Normalized text, or "" if value is None.
    """
    if value is None:
        return ""
    value = str(value).strip().lower()
    value = unicodedata.normalize("NFKD", value)
    return "".join(char for char in value if not unicodedata.combining(char))
