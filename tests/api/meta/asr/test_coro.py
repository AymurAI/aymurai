from datetime import timedelta

import pytest

from aymurai.api.meta.asr.coro import (
    CoroSegment,
    CoroStreamDelta,
    CoroStreamSegments,
    _parse_hhmmss,
)


def test_parse_hhmmss_accepts_colon_format():
    assert _parse_hhmmss("00:01:02") == timedelta(minutes=1, seconds=2)


def test_parse_hhmmss_accepts_iso8601_duration():
    assert _parse_hhmmss("PT1H2M3S") == timedelta(hours=1, minutes=2, seconds=3)


def test_parse_hhmmss_accepts_numeric_seconds():
    assert _parse_hhmmss(90) == timedelta(seconds=90)
    assert _parse_hhmmss(90.5) == timedelta(seconds=90.5)


def test_parse_hhmmss_passes_through_timedelta():
    td = timedelta(seconds=5)
    assert _parse_hhmmss(td) is td


def test_parse_hhmmss_rejects_invalid_string():
    with pytest.raises(ValueError):
        _parse_hhmmss("not-a-time")


def test_coro_segment_ignores_unknown_fields():
    segment = CoroSegment.model_validate(
        {"start": 0.0, "end": 1.5, "text": "hola", "speaker": "1", "extra": "x"}
    )
    assert segment.start == 0.0
    assert segment.speaker == "1"


def test_coro_stream_segments_wraps_segment_list():
    wrapped = CoroStreamSegments(
        segments=[CoroSegment(start=0.0, end=1.0, text="hi", speaker="1")]
    )
    assert len(wrapped.segments) == 1


def test_coro_stream_delta_holds_text():
    assert CoroStreamDelta(text="chunk").text == "chunk"
