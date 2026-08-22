import re
from copy import deepcopy

from aymurai.meta.pipeline_interfaces import Transform
from aymurai.meta.types import DataItem
from aymurai.text.normalize import ZERO_WIDTH_CHARS_PATTERN


class FlairTextNormalize(Transform):
    """
    Normalize text for Flair
    """

    @staticmethod
    def normalize_text(text: str) -> str:
        # strip the zero-width characters that flair.data.Sentence silently
        # deletes before tokenizing (flair 0.15.1,
        # Sentence.__remove_zero_width_characters). The pattern is shared
        # with aymurai.text.normalize so /document-extract output stays a
        # fixed point of this normalization (offsets aligned end-to-end).
        # Doing this first, before whitespace collapsing, keeps predicted
        # offsets aligned with this normalized text.
        # U+2028/U+2029 (LINE/PARAGRAPH SEPARATOR) are intentionally excluded
        # here: flair removes those too, but they are still literal characters
        # at this point and the whitespace collapse below already turns them
        # into a single space, which is the existing, pinned behavior.
        text = re.sub(ZERO_WIDTH_CHARS_PATTERN, "", text)

        # replace '\t' and '\xa0' for white space
        text = re.sub(r"(?:\t|\xa0)+", " ", text)

        # remove multiple spaces except new lines
        text = re.sub(r"[^\S\r\n]+", " ", text)

        # replace multiple new lines with just one break
        text = re.sub(r"\n+", "\n", text)

        return text

    def __call__(self, item: DataItem) -> DataItem:
        item = deepcopy(item)

        doc = item["data"]["doc.text"]
        doc = self.normalize_text(doc)

        item["data"]["doc.text"] = doc

        return item
