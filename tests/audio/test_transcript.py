from datetime import timedelta

import pytest

from aymurai.audio.transcript import (
    diarized_segments,
    ends_sentence,
    merge_speaker_turns_by_sentence,
    speaker_turns_from_validated_paragraphs,
    transcript_turns,
)
from aymurai.meta.api_interfaces import ASRParagraph


def _paragraph(speaker_no, start, end, text, speaker_name=None):
    return ASRParagraph(
        speaker_no=speaker_no,
        speaker_name=speaker_name,
        start=timedelta(seconds=start),
        end=timedelta(seconds=end),
        text=text,
    )


def test_ends_sentence_detects_sentence_closing_punctuation():
    assert ends_sentence("Hola.")
    assert ends_sentence("¿Se entiende?")
    assert not ends_sentence("entonces,")
    assert not ends_sentence("")


def test_merge_combines_consecutive_same_speaker_without_sentence_close():
    segments = diarized_segments(
        {
            "document": [
                _paragraph(1, 0.0, 1.0, "Nos quedamos,"),
                _paragraph(1, 1.0, 2.0, "esperando en el lobby."),
            ]
        }
    )
    turns = merge_speaker_turns_by_sentence(segments)
    assert len(turns) == 1
    assert turns[0]["speaker"] == "Speaker 1"
    assert turns[0]["text"] == "Nos quedamos, esperando en el lobby."


def test_merge_splits_turn_on_speaker_change():
    segments = diarized_segments(
        {
            "document": [
                _paragraph(1, 0.0, 1.0, "Hola."),
                _paragraph(2, 1.0, 2.0, "Hola tambien."),
            ]
        }
    )
    turns = merge_speaker_turns_by_sentence(segments)
    assert [t["speaker"] for t in turns] == ["Speaker 1", "Speaker 2"]


def test_diarized_segments_raises_on_missing_document():
    with pytest.raises(ValueError):
        diarized_segments({})


def test_diarized_segments_uses_speaker_name_when_present():
    segments = diarized_segments(
        {"document": [_paragraph(1, 0.0, 1.0, "Hola.", speaker_name="Juli")]}
    )
    turns = merge_speaker_turns_by_sentence(segments)
    assert turns[0]["speaker"] == "Juli"


def test_transcript_turns_serializes_start_end_as_timestamps():
    turns = transcript_turns({"document": [_paragraph(1, 0.0, 61.0, "Hola.")]})
    assert turns[0]["start"] == "00:00:00.000"
    assert turns[0]["end"] == "00:01:01.000"


def test_speaker_turns_from_validated_paragraphs_skips_blank_text():
    paragraphs = [
        _paragraph(1, 0.0, 1.0, "  "),
        _paragraph(1, 1.0, 2.0, "hola"),
    ]
    turns = speaker_turns_from_validated_paragraphs(paragraphs)
    assert len(turns) == 1
    assert turns[0]["text"] == "hola"
