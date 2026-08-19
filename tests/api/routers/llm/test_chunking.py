import pytest

from aymurai.api.endpoints.routers.llm.chunking import Window, take_window
from aymurai.llm_providers.tokens import TokenPiece


def _pieces(*texts: str) -> list[TokenPiece]:
    """Build a piece list; ids are irrelevant to windowing."""
    return [TokenPiece(id=i, piece=t) for i, t in enumerate(texts)]


def test_whole_document_fits_in_one_window():
    pieces = _pieces("Hola", " mundo", ".")

    window = take_window(pieces, 0, max_tokens=10)

    assert window.text == "Hola mundo."
    assert window.token_count == 3
    assert window.next_start == 3  # == len(pieces) signals exhaustion


def test_window_is_capped_at_max_tokens():
    pieces = _pieces(*[f" w{i}" for i in range(10)])

    window = take_window(pieces, 0, max_tokens=4)

    assert window.token_count <= 4
    assert window.next_start < len(pieces)


def test_pieces_concatenate_without_added_separators():
    pieces = _pieces("Nu", "ñez", " compareció")

    window = take_window(pieces, 0, max_tokens=10)

    assert window.text == "Nuñez compareció"


def test_snaps_backward_to_paragraph_break():
    # 8 tokens; a paragraph break sits at index 3. A 6-token cap must snap
    # back to just after the break rather than cutting at index 6.
    pieces = _pieces(
        "uno", " dos", " tres", ".\n\n", "cuatro", " cinco", " seis", " siete"
    )

    window = take_window(pieces, 0, max_tokens=6)

    assert window.text.endswith("\n\n")
    assert window.token_count == 4


def test_snaps_backward_to_word_boundary_when_no_newline():
    # No newline anywhere: must not split mid-word, so the window ends
    # before a whitespace-led token.
    pieces = _pieces("El", " juz", "gado", " resolvió", " hacer", " lugar")

    window = take_window(pieces, 0, max_tokens=3)

    assert window.text == "El juzgado"
    assert window.token_count == 3


def test_hard_cut_when_no_boundary_within_lookback():
    pieces = _pieces(*[f"x{i}" for i in range(10)])  # no whitespace at all

    window = take_window(pieces, 0, max_tokens=4)

    assert window.token_count == 4
    assert window.next_start == 4


def test_overlap_rolls_the_next_start_backward():
    pieces = _pieces(*[f" w{i}" for i in range(20)])

    window = take_window(pieces, 0, max_tokens=8, overlap=3)

    assert window.next_start == window.token_count - 3


def test_overlap_always_advances_to_avoid_an_infinite_loop():
    pieces = _pieces(*[f" w{i}" for i in range(20)])

    window = take_window(pieces, 0, max_tokens=2, overlap=99)

    assert window.next_start > 0


def test_start_beyond_the_end_yields_an_empty_terminal_window():
    pieces = _pieces("a", "b")

    window = take_window(pieces, 2, max_tokens=4)

    assert window == Window(text="", token_count=0, next_start=2)


def test_full_document_is_reconstructed_by_iterating_windows():
    pieces = _pieces("uno", " dos", " tres", " cuatro", " cinco", " seis")
    document = "".join(p.piece for p in pieces)

    collected, start = [], 0
    while start < len(pieces):
        window = take_window(pieces, start, max_tokens=2)
        collected.append(window.text)
        start = window.next_start

    assert "".join(collected) == document


def test_rejects_non_positive_max_tokens():
    with pytest.raises(ValueError, match="max_tokens"):
        take_window(_pieces("a"), 0, max_tokens=0)
