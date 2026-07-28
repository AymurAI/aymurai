from datetime import timedelta

from aymurai.meta.api_interfaces import (
    ASRDocument,
    ASRParagraph,
    ASRParagraphRequest,
    ASRSpeakerTurn,
    ASRValidationDocumentRequest,
)


def test_asr_paragraph_parses_hhmmss_start_end():
    paragraph = ASRParagraph(
        speaker_no=1, start="00:00:01", end="00:00:02", text="hola"
    )
    assert paragraph.start == timedelta(seconds=1)
    assert paragraph.end == timedelta(seconds=2)


def test_asr_paragraph_paragraph_id_is_deterministic_on_text():
    a = ASRParagraph(speaker_no=1, start=0, end=1, text="hola")
    b = ASRParagraph(speaker_no=2, start=5, end=6, text="hola")
    assert a.paragraph_id == b.paragraph_id


def test_asr_paragraph_to_txt_includes_speaker_and_timerange():
    paragraph = ASRParagraph(speaker_no=1, start=0, end=1, text="hola")
    txt = paragraph.to_txt()
    assert "00:00:00 - 00:00:01" in txt
    assert "speaker 1" in txt
    assert "hola" in txt


def test_asr_validation_document_request_rejects_blank_title():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ASRValidationDocumentRequest(title="   ", document=[])


def test_asr_document_to_txt_joins_paragraphs():
    doc = ASRDocument(
        document=[
            ASRParagraph(speaker_no=1, start=0, end=1, text="uno"),
            ASRParagraph(speaker_no=1, start=1, end=2, text="dos"),
        ],
        document_id="00000000-0000-0000-0000-000000000000",
    )
    assert "uno" in doc.to_txt()
    assert "dos" in doc.to_txt()


def test_asr_speaker_turn_holds_segments():
    turn = ASRSpeakerTurn(
        speaker="Speaker 1",
        speaker_no=1,
        start="00:00:00",
        end="00:00:01",
        text="hola",
        segments=[ASRParagraph(speaker_no=1, start=0, end=1, text="hola")],
    )
    assert len(turn.segments) == 1


def test_asr_paragraph_request_accepts_plain_fields():
    request = ASRParagraphRequest(speaker_no=1, start=0, end=1, text="hola")
    assert request.text == "hola"
