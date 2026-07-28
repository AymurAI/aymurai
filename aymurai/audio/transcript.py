from datetime import timedelta
from typing import Any

SENTENCE_END_CHARS = {".", "!", "?", "…"}


def _segment_value(item: Any, key: str) -> Any:
    """Read `key` from either a dict or an attribute-holding object (e.g. ASRParagraph)."""
    if isinstance(item, dict):
        return item.get(key)
    return getattr(item, key, None)


def ends_sentence(text: str) -> bool:
    if not text:
        return False
    stripped = text.rstrip()
    if not stripped:
        return False
    return stripped[-1] in SENTENCE_END_CHARS


def parse_time_seconds(value: timedelta | float | int | str) -> float:
    if isinstance(value, timedelta):
        return value.total_seconds()
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            parts = value.split(":")
            if len(parts) != 3:
                raise ValueError(f"Cannot parse time value: {value!r}") from None
            hours, minutes, seconds = parts
            return int(hours) * 3600 + int(minutes) * 60 + float(seconds)

    raise ValueError(f"Cannot parse time value: {value!r}")


def format_timestamp(seconds: float) -> str:
    total_ms = round(seconds * 1000)
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, ms = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"


def diarized_segments(payload: dict) -> list[dict]:
    if not isinstance(payload, dict) or "document" not in payload:
        raise ValueError("payload must contain a 'document' key")

    segments = []
    for item in payload["document"]:
        speaker_no = _segment_value(item, "speaker_no")
        speaker_name = _segment_value(item, "speaker_name")
        speaker_label = (speaker_name or "").strip() or f"Speaker {speaker_no}"

        segments.append(
            {
                "speaker": speaker_label,
                "speaker_no": speaker_no,
                "start": _segment_value(item, "start"),
                "end": _segment_value(item, "end"),
                "text": _segment_value(item, "text"),
                "paragraph": item,
            }
        )

    return segments


def merge_speaker_turns_by_sentence(segments: list[dict]) -> list[dict]:
    turns: list[dict] = []
    current: dict | None = None
    current_closed = True

    for segment in segments:
        if (
            current is not None
            and not current_closed
            and current["speaker"] == segment["speaker"]
        ):
            current["text"] = f"{current['text']} {segment['text']}".strip()
            current["end"] = segment["end"]
            current["segments"].append(segment["paragraph"])
        else:
            current = {
                "speaker": segment["speaker"],
                "speaker_no": segment["speaker_no"],
                "start": segment["start"],
                "end": segment["end"],
                "text": segment["text"],
                "segments": [segment["paragraph"]],
            }
            turns.append(current)

        current_closed = ends_sentence(segment["text"])

    return turns


def _format_turns(turns: list[dict]) -> list[dict]:
    return [
        {
            "speaker": turn["speaker"],
            "speaker_no": turn["speaker_no"],
            "start": format_timestamp(parse_time_seconds(turn["start"])),
            "end": format_timestamp(parse_time_seconds(turn["end"])),
            "text": turn["text"],
            "segments": turn["segments"],
        }
        for turn in turns
    ]


def transcript_turns(payload: dict) -> list[dict]:
    segments = diarized_segments(payload)
    turns = merge_speaker_turns_by_sentence(segments)
    return _format_turns(turns)


def speaker_turns_from_validated_paragraphs(paragraphs: list) -> list[dict]:
    non_blank = [
        paragraph
        for paragraph in paragraphs
        if (_segment_value(paragraph, "text") or "").strip()
    ]
    segments = diarized_segments({"document": non_blank})
    turns = merge_speaker_turns_by_sentence(segments)
    return _format_turns(turns)


def markdown_transcript(payload: dict, title: str) -> str:
    turns = transcript_turns(payload)
    lines = [f"# {title}", ""]
    for turn in turns:
        lines.append(f"**{turn['speaker']}** ({turn['start']} - {turn['end']})")
        lines.append("")
        lines.append(turn["text"])
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
