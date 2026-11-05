import re
from copy import deepcopy
from datetime import datetime

from datetime_matcher import DatetimeMatcher

from aymurai.meta.pipeline_interfaces import Transform
from aymurai.meta.types import DataItem
from aymurai.utils.misc import get_element

from .patterns import patterns

_DAY_TOKEN_PATTERN = re.compile(r"\d{1,2}")


def extract_valid_datetime(
    dtm: DatetimeMatcher, pattern: str, text: str
) -> datetime | None:
    """
    Wraps `DatetimeMatcher.extract_datetime`, guarding against its silent
    misparse of out-of-range days -- e.g. "32 de enero de 2024" comes back as
    day 2 instead of failing, since the underlying regex has no bounds check.
    Every day-of-month a date pattern extracts must actually appear verbatim
    as a 1-2 digit token in the source text; patterns with no day component
    (e.g. hour-only ones) are returned as-is.

    Args:
        dtm (DatetimeMatcher): Matcher instance to delegate to.
        pattern (str): The strptime-style pattern being tried.
        text (str): Text to extract a datetime from.

    Returns:
        datetime | None: The extracted datetime, or None if it didn't match
            or failed the day sanity check.
    """
    parsed = dtm.extract_datetime(pattern, text)
    if parsed is None:
        return None
    if "%d" not in pattern and "%-d" not in pattern:
        return parsed

    day_tokens = {int(m) for m in _DAY_TOKEN_PATTERN.findall(text)}
    return parsed if parsed.day in day_tokens else None


class DatetimeFormatter(Transform):
    """
    Format datetime entities
    """

    def __init__(self, field: str = "predictions"):
        """
        Args:
            field (str, optional): field with entities. Defaults to "predictions".
        """
        self.field = field
        self.dtm = DatetimeMatcher()
        self.VALID_ENTS = list(patterns.keys())

        self.day0 = self.dtm.extract_datetime("%H:%M", "00:00")

    def process(self, ent):
        """
        parse datetime and format it. If it is a date, format it as dd/mm/yyyy
        if it is a time, format it as hh:mm

        Args:
            ent (dict): entity to process

        Returns:
            dict: processed entity
        """
        if (label := ent["label"]) not in self.VALID_ENTS:
            return ent

        pats = patterns.get(label, [])
        suggestions = []
        for pat in pats:
            parsed_datetime = extract_valid_datetime(self.dtm, pat, ent["text"])
            if not parsed_datetime:
                continue

            diff = parsed_datetime - self.day0
            # not a date, handle just as time
            if diff.days == 0:
                text_repr = parsed_datetime.strftime("%H:%M")
            # handle it has date
            else:
                text_repr = parsed_datetime.strftime("%d/%m/%Y")
            suggestions.append(text_repr)

        ent["attrs"]["aymurai_label_subclass"] = (
            [max(suggestions)] if suggestions else []
        )

        return ent

    def __call__(self, item: DataItem) -> DataItem:
        """
        Args:
            item (DataItem): item to process

        Returns:
            DataItem: processed item
        """
        item = deepcopy(item)

        ents = get_element(item, [self.field, "entities"]) or []
        ents = [self.process(ent) for ent in ents]

        return item
