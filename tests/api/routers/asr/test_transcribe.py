from typing import Any, cast
from unittest.mock import AsyncMock, patch

from sqlmodel import Session

from aymurai.database.meta.audio_transcription import AudioTranscription
from aymurai.database.utils import data_to_uuid
from aymurai.api.meta.asr.coro import CoroSegment
from aymurai.meta.api_interfaces import ASRDocument, ASRParagraph


def test_transcribe_persists_document_when_service_returns_paragraphs(
    asr_test_client,
):
    client, engine = asr_test_client
    audio_bytes = b"fake-wav-bytes"
    document_id = data_to_uuid(audio_bytes)

    fake_segments = [CoroSegment(start=0.0, end=1.0, text="Hola mundo", speaker="1")]

    with patch(
        "aymurai.api.endpoints.routers.asr.transcribe.transcribe_audio_bytes",
        new=AsyncMock(return_value=fake_segments),
    ):
        response = client.post(
            "/asr/transcribe?use_cache=false",
            files={"file": ("sample.wav", audio_bytes, "audio/wav")},
        )

    assert response.status_code == 200
    payload = ASRDocument.model_validate(response.json())
    assert str(payload.document_id) == str(document_id)
    assert payload.document[0].text == "Hola mundo"
    assert response.json()["speaker_turns"][0]["speaker"] == "Speaker 1"

    with Session(engine) as session:
        record = session.get(AudioTranscription, document_id)
        assert record is not None
        assert record.name == "sample.wav"


def test_transcribe_uses_cache_and_skips_coro_call_on_hit(asr_test_client):
    client, engine = asr_test_client
    audio_bytes = b"cached-audio-bytes"
    document_id = data_to_uuid(audio_bytes)

    with Session(engine) as session:
        session.add(
            AudioTranscription(
                id=document_id,
                name="cached.wav",
                transcription=cast(
                    Any,
                    [
                        ASRParagraph(
                            speaker_no=1, start=0, end=1, text="Nos quedamos,"
                        ).model_dump(mode="json"),
                    ],
                ),
                validation=[],
            )
        )
        session.commit()

    def _fail(*args, **kwargs):
        raise AssertionError("coro must not be called on a cache hit")

    with patch(
        "aymurai.api.endpoints.routers.asr.transcribe.transcribe_audio_bytes",
        new=_fail,
    ):
        response = client.post(
            "/asr/transcribe",
            files={"file": ("cached.wav", audio_bytes, "audio/wav")},
        )

    assert response.status_code == 200
    assert response.json()["document"][0]["text"] == "Nos quedamos,"


def test_validation_document_returns_404_when_missing(asr_test_client):
    client, _engine = asr_test_client
    missing_id = data_to_uuid(b"never-uploaded-audio")
    response = client.get(f"/asr/validation/document/{missing_id}")
    assert response.status_code == 404


def test_validation_document_get_then_post_roundtrip(asr_test_client):
    client, engine = asr_test_client
    audio_bytes = b"roundtrip-audio"
    document_id = data_to_uuid(audio_bytes)

    with Session(engine) as session:
        session.add(
            AudioTranscription(
                id=document_id,
                name="roundtrip.wav",
                transcription=cast(
                    Any,
                    [
                        ASRParagraph(
                            speaker_no=1, start=0, end=1, text="hola"
                        ).model_dump(mode="json"),
                    ],
                ),
                validation=[],
            )
        )
        session.commit()

    get_response = client.get(f"/asr/validation/document/{document_id}")
    assert get_response.status_code == 200
    assert get_response.json()["document"][0]["text"] == "hola"

    post_response = client.post(
        f"/asr/validation/document/{document_id}",
        json=[
            {
                "speaker_no": 1,
                "start": 0,
                "end": 1,
                "text": "hola corregido",
            }
        ],
    )
    assert post_response.status_code == 200

    with Session(engine) as session:
        record = session.get(AudioTranscription, document_id)
        assert record.validation[0]["text"] == "hola corregido"


def test_transcribe_returns_502_when_coro_errors(asr_test_client):
    client, _engine = asr_test_client
    audio_bytes = b"errors-out"

    async def _raise(*args, **kwargs):
        raise RuntimeError("upstream boom")

    with patch(
        "aymurai.api.endpoints.routers.asr.transcribe.transcribe_audio_bytes",
        new=_raise,
    ):
        response = client.post(
            "/asr/transcribe?use_cache=false",
            files={"file": ("boom.wav", audio_bytes, "audio/wav")},
        )

    assert response.status_code == 502
