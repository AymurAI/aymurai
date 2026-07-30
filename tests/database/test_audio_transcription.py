from sqlmodel import Session, SQLModel, StaticPool, create_engine

from aymurai.database.crud.audio_transcription import (
    audio_transcription_create_or_update,
    audio_transcription_get,
)
from aymurai.database.utils import text_to_uuid
from aymurai.meta.api_interfaces import ASRParagraph


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_create_or_update_creates_new_record_when_missing():
    engine = _engine()
    transcription_id = text_to_uuid("audio-1")
    paragraphs = [ASRParagraph(speaker_no=1, start=0, end=1, text="hola")]

    with Session(engine) as session:
        record = audio_transcription_create_or_update(
            transcription_id=transcription_id,
            name="audio-1.wav",
            transcription=paragraphs,
            session=session,
        )
        assert record.id == transcription_id
        assert record.name == "audio-1.wav"
        assert record.validation == []


def test_get_returns_none_when_not_found():
    engine = _engine()
    with Session(engine) as session:
        assert audio_transcription_get(text_to_uuid("missing"), session) is None


def test_create_or_update_overwrites_existing_record_and_clears_validation():
    engine = _engine()
    transcription_id = text_to_uuid("audio-2")
    first = [ASRParagraph(speaker_no=1, start=0, end=1, text="uno")]
    second = [ASRParagraph(speaker_no=1, start=0, end=1, text="dos")]

    with Session(engine) as session:
        audio_transcription_create_or_update(
            transcription_id=transcription_id,
            name="first.wav",
            transcription=first,
            session=session,
        )

    with Session(engine) as session:
        updated = audio_transcription_create_or_update(
            transcription_id=transcription_id,
            name="second.wav",
            transcription=second,
            session=session,
        )
        assert updated.name == "second.wav"
        assert updated.transcription[0]["text"] == "dos"
        assert updated.validation == []
