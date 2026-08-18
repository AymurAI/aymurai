"""Pure token-window slicing for document summarization.

Consumes an already-tokenized piece list (from llama.cpp's `/tokenize` with
`with_pieces=true`, whose pieces concatenate back to the source exactly) and
yields one window at a time. Deliberately free of I/O so it can be unit-tested
without a server or a mock.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

from aymurai.llm_providers.tokens import TokenPiece

# Fraction of a window we are willing to give up to land on a clean boundary.
# Too small and we rarely snap; too large and windows shrink noticeably.
_LOOKBACK_RATIO = 0.25


@dataclass(frozen=True)
class Window:
    """One slice of a document, sized by exact token count."""

    text: str
    token_count: int
    next_start: int


def take_window(
    pieces: Sequence[TokenPiece],
    start: int,
    *,
    max_tokens: int,
    overlap: int = 0,
) -> Window:
    """
    Build the window beginning at `start`.

    Fills up to `max_tokens`, then snaps the cut backward to the nearest clean
    boundary within a bounded lookback so windows do not end mid-word.

    Args:
        pieces: The whole document's tokens, in order.
        start: Index to begin this window at.
        max_tokens: Hard ceiling on this window's token count.
        overlap: Tokens to replay at the start of the following window.

    Raises:
        ValueError: If `max_tokens` is not positive.

    Returns:
        Window: Its `next_start` equals `len(pieces)` once the document is
            exhausted, and is always strictly greater than `start` otherwise,
            so callers cannot loop forever.
    """
    if max_tokens <= 0:
        raise ValueError(f"max_tokens must be positive, got {max_tokens}")

    if start >= len(pieces):
        return Window(text="", token_count=0, next_start=len(pieces))

    hard_end = min(start + max_tokens, len(pieces))
    end = (
        hard_end if hard_end >= len(pieces) else _snap_backward(pieces, start, hard_end)
    )

    text = "".join(piece.piece for piece in pieces[start:end])
    token_count = end - start

    if end >= len(pieces):
        return Window(text=text, token_count=token_count, next_start=len(pieces))

    next_start = max(end - overlap, start + 1)
    return Window(text=text, token_count=token_count, next_start=next_start)


def _snap_backward(pieces: Sequence[TokenPiece], start: int, hard_end: int) -> int:
    """
    Move a window's end backward onto the cleanest nearby boundary.

    Preference order: paragraph break, then any newline, then a word boundary
    (the following token begins with whitespace). Falls back to `hard_end`
    when nothing suitable is in range, accepting a mid-word cut rather than
    shrinking the window arbitrarily.

    Args:
        pieces: The whole document's tokens.
        start: Index the window begins at.
        hard_end: Exclusive end implied by the token budget.

    Returns:
        int: The exclusive end index to use.
    """
    span = hard_end - start
    min_end = max(start + 1, hard_end - max(1, math.ceil(span * _LOOKBACK_RATIO)))

    for candidate in range(hard_end, min_end - 1, -1):
        if "\n\n" in pieces[candidate - 1].piece:
            return candidate

    for candidate in range(hard_end, min_end - 1, -1):
        if "\n" in pieces[candidate - 1].piece:
            return candidate

    for candidate in range(hard_end, min_end - 1, -1):
        if candidate < len(pieces) and pieces[candidate].piece[:1].isspace():
            return candidate

    return hard_end


__all__ = ["Window", "take_window"]
