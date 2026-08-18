"""Token types shared by the provider and the summarization pipeline.

A dependency-free leaf module: the provider produces `TokenPiece`s and the
chunking layer consumes them, so neither has to import the other.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TokenPiece:
    """A single token and the exact source text it covers."""

    id: int
    piece: str


__all__ = ["TokenPiece"]
