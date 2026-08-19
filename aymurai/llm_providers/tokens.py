from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TokenPiece:
    """A single token and the exact source text it covers."""

    id: int
    piece: str


__all__ = ["TokenPiece"]
