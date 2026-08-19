import pytest
from flair.data import Sentence

from aymurai.models.flair.utils import FlairTextNormalize

# Characters flair.data.Sentence.__remove_zero_width_characters (flair 0.15.1)
# silently deletes before tokenizing.
ZERO_WIDTH_CHARS = ["\u200b", "\u200c", "\ufe0f", "\ufeff"]


@pytest.mark.parametrize("zero_width_char", ZERO_WIDTH_CHARS)
def test_normalize_text_strips_zero_width_characters(zero_width_char):
    dirty = f"hola {zero_width_char}mundo"

    normalized = FlairTextNormalize.normalize_text(dirty)

    assert zero_width_char not in normalized
    assert normalized == "hola mundo"


def test_normalize_text_still_collapses_line_and_paragraph_separators_to_space():
    # U+2028/U+2029 are pinned to the existing whitespace-collapse behavior;
    # they are not part of the zero-width strip.
    dirty = "hola\u2028mundo\u2029test"

    normalized = FlairTextNormalize.normalize_text(dirty)

    assert normalized == "hola mundo test"


@pytest.mark.parametrize("zero_width_char", ZERO_WIDTH_CHARS)
def test_flair_sentence_token_offsets_align_with_normalized_text(zero_width_char):
    """Contract test: flair.Sentence always strips these characters internally
    before tokenizing. If our normalized text still contained them, flair's
    reported token offsets (relative to its own, further-stripped text) would
    no longer index correctly into our normalized text. This is the seam that
    caused misaligned NER offsets end to end.
    """
    dirty = f"hola {zero_width_char}mundo bonito"
    normalized_text = FlairTextNormalize.normalize_text(dirty)

    sentence = Sentence(normalized_text, use_tokenizer=False)

    assert len(sentence) > 0
    for token in sentence:
        start = token.start_position
        assert normalized_text[start : start + len(token.text)] == token.text
