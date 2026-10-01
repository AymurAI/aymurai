import re
from datetime import date

from datetime_matcher import DatetimeMatcher

from .core import extract_valid_datetime
from .patterns import DATES

_dtm = DatetimeMatcher()

# `DATES`'s last pattern (`"%-d de %B"`) has no year token at all -- tried
# against text that *does* have a year, it still matches (ignoring the year
# in the text) and silently defaults to year 1900 instead of failing.
# Confirmed: dtm.extract_datetime(r"(?i)%-d de %B", "5 de mayo de 2024") ->
# 1900-05-05. A recommendation date is always meant to carry a real year (per
# our own prompt's format), so we only ever try patterns that require one.
_YEAR_REQUIRED_DATES = [p for p in DATES if "%Y" in p or "%y" in p]

# Locale-independent fallback for exactly the one prose shape our own prompt
# asks the LLM for ("DD de MES de YYYY"): `DATES`'s %B patterns need the
# es_AR locale, which not every machine running this code has (see
# aymurai.transforms.datetime_formatter.patterns). Without it, every %B
# pattern simply fails to match -- this fallback keeps this one shape
# parseable everywhere regardless of the OS locale.
_SPANISH_MONTHS = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}
_PROSE_DATE_PATTERN = re.compile(
    r"(\d{1,2})\s*(?:°|º|ro\.?)?\s+de\s+([a-záéíóúñ]+)\s+de[l]?\s+(\d{4})",
    re.IGNORECASE,
)


def _parse_spanish_prose_date(text: str) -> date | None:
    match = _PROSE_DATE_PATTERN.search(text)
    if not match:
        return None
    day, month_name, year = match.groups()
    month = _SPANISH_MONTHS.get(month_name.lower())
    if month is None:
        return None
    try:
        return date(int(year), month, int(day))
    except ValueError:
        return None


def parse_recommendation_date(text: str | None) -> date | None:
    """
    Parses verbatim date prose (e.g. "01 de enero de 2024") into a real date.

    Tries the house `DATES` patterns first (shared with
    `aymurai.transforms.datetime_formatter`, day-validated by
    `extract_valid_datetime`) -- these need the es_AR locale to match month
    names, which isn't installed on every machine. When none match (whether
    because the locale is missing or the shape is genuinely different), falls
    back to a locale-independent parser for our own prompt's one prose shape.

    Args:
        text (str | None): Verbatim date prose from the model/human.

    Returns:
        date | None: The parsed date, or None if nothing recognized it.
    """
    if not text:
        return None

    for pattern in _YEAR_REQUIRED_DATES:
        parsed = extract_valid_datetime(_dtm, pattern, text)
        if parsed:
            return parsed.date()

    return _parse_spanish_prose_date(text)
