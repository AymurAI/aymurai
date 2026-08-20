import re
import warnings
from datetime import timedelta
from typing import Any

SENTENCE_END_RE = re.compile(r"(?:[.!?]+|[.!?]+[\"')\]]+)\s*$")


def parse_time_seconds(value: str | float | timedelta) -> float:
    """
    Parse a time value in HH:MM:SS, ISO 8601 duration (PT#H#M#S), or seconds.

    Args:
        value (str | int | float | timedelta): The time value to parse.

    Returns:
        float: The parsed time value, in seconds.
    """
    if isinstance(value, timedelta):
        return value.total_seconds()
    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).strip()

    iso_match = re.fullmatch(
        r"PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?",
        text,
    )
    if iso_match:
        hours = float(iso_match.group(1) or 0)
        minutes = float(iso_match.group(2) or 0)
        seconds = float(iso_match.group(3) or 0)
        return hours * 3600 + minutes * 60 + seconds

    hhmmss = text.split(":")
    if len(hhmmss) == 3:
        hours, minutes, seconds = hhmmss
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)

    return float(text)


def format_timestamp(seconds: float) -> str:
    """
    Format a number of seconds as an HH:MM:SS.mmm timestamp.

    Args:
        seconds (float): The time value to format, in seconds. Negative values
            are clamped to 0.

    Returns:
        str: The formatted timestamp.
    """
    normalized = max(0.0, seconds)
    whole_seconds = int(normalized)
    millis = round((normalized - whole_seconds) * 1000)
    if millis == 1000:
        whole_seconds += 1
        millis = 0
    hours, remainder = divmod(whole_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def _segment_value(segment: Any, field: str) -> Any:
    """
    Read a field from either a dict or an attribute-holding object (e.g. ASRParagraph).

    Args:
        segment (Any): The segment to read from, a dict or an object with
            attributes.
        field (str): The field name to read.

    Returns:
        Any: The field's value, or None if the object has no such attribute.
    """
    if isinstance(segment, dict):
        return segment.get(field)
    return getattr(segment, field)


def ends_sentence(text: str) -> bool:
    """
    Check whether text ends with sentence-closing punctuation.

    Args:
        text (str): The text to check.

    Returns:
        bool: True if the text ends with `.`, `!`, or `?` (optionally followed
            by a closing quote or bracket), False otherwise.
    """
    return bool(SENTENCE_END_RE.search(text.strip()))


def speaker_label(segment: dict[str, Any]) -> str:
    """
    Build a display label for a segment's speaker.

    Args:
        segment (dict[str, Any]): The segment, expected to have `speaker_name`
            and `speaker_no` keys.

    Returns:
        str: The speaker's name if present and non-blank, otherwise
            "Speaker {speaker_no}".
    """
    name = str(segment.get("speaker_name") or "").strip()
    if name:
        return name
    return f"Speaker {segment['speaker_no']}"


def diarized_segments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Read diarized ASR paragraphs from a payload with a document field.

    Validates that each item carries `speaker_no`, `start`, `end`, and `text`,
    that timestamps are non-negative and non-decreasing per item, and that at
    least one item has non-blank text. Items with blank text are dropped.

    Args:
        payload (dict[str, Any]): A payload with a `document` key holding a
            non-empty list of diarized items (dicts or ASRParagraph-like
            objects).

    Raises:
        ValueError: If `document` is missing/empty, an item is missing a
            required field, has an empty speaker label, has invalid
            timestamps, or no item has non-blank text.

    Returns:
        list[dict[str, Any]]: The segments as plain dicts, each augmented with
            `_start_seconds`, `_end_seconds`, and `_text` (parsed/normalized
            copies of `start`/`end`/`text`), ordered by timestamp. A warning is
            emitted if the input was not already timestamp-ordered.
    """
    document = payload.get("document")
    if not isinstance(document, list) or not document:
        raise ValueError("Diarized response is missing a non-empty 'document' list")

    segments: list[dict[str, Any]] = []
    for index, item in enumerate(document):
        missing = [
            field
            for field in ("speaker_no", "start", "end", "text")
            if _segment_value(item, field) is None
        ]
        if missing:
            raise ValueError(
                f"document[{index}] is missing diarization field(s): {missing}"
            )

        speaker_no = _segment_value(item, "speaker_no")
        if str(speaker_no).strip() == "":
            raise ValueError(f"document[{index}] has an empty speaker label")

        text = str(_segment_value(item, "text") or "").strip()
        if not text:
            continue

        start = parse_time_seconds(_segment_value(item, "start"))
        end = parse_time_seconds(_segment_value(item, "end"))
        if start < 0 or end < start:
            raise ValueError(
                f"document[{index}] has invalid timestamps: start={start}, end={end}"
            )

        if isinstance(item, dict):
            segment = dict(item)
        else:
            segment = item.model_dump(mode="json")
        segment["_start_seconds"] = start
        segment["_end_seconds"] = end
        segment["_text"] = text
        segments.append(segment)

    if not segments:
        raise ValueError("Diarized response contains no non-empty speech segments")

    ordered = sorted(
        segments, key=lambda item: (item["_start_seconds"], item["_end_seconds"])
    )
    if [id(item) for item in ordered] != [id(item) for item in segments]:
        warnings.warn(
            "Diarized segments were not ordered by timestamp; transcript will be timestamp-sorted",
            stacklevel=2,
        )

    return ordered


def _new_turn(segment: dict[str, Any]) -> dict[str, Any]:
    """
    Start a new speaker turn from a single diarized segment.

    Args:
        segment (dict[str, Any]): A segment as returned by `diarized_segments`
            (must carry `speaker_no`, `_start_seconds`, `_end_seconds`, `_text`).

    Returns:
        dict[str, Any]: A new turn accumulator with one segment so far.
    """
    return {
        "speaker": speaker_label(segment),
        "speaker_no": segment["speaker_no"],
        "start": segment["_start_seconds"],
        "end": segment["_end_seconds"],
        "texts": [segment["_text"]],
        "segments": [segment],
    }


def merge_speaker_turns_by_sentence(
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Merge consecutive same-speaker segments into turns, splitting on sentence ends.

    A new turn starts whenever the speaker changes or the previous turn's
    accumulated text already ends a sentence (see `ends_sentence`); otherwise
    the segment is appended to the current turn.

    Args:
        segments (list[dict[str, Any]]): Segments as returned by
            `diarized_segments`, in timestamp order.

    Returns:
        list[dict[str, Any]]: The merged turns, each with `speaker`,
            `speaker_no`, `start`/`end` (seconds), `texts` (list of pieces),
            `text` (joined), and `segments` (the raw segments that make up
            the turn).
    """
    turns: list[dict[str, Any]] = []
    for segment in segments:
        label = speaker_label(segment)
        previous = turns[-1] if turns else None
        starts_new_turn = (
            previous is None
            or previous["speaker"] != label
            or ends_sentence(" ".join(previous["texts"]))
        )

        if starts_new_turn:
            turns.append(_new_turn(segment))
            continue

        previous["end"] = segment["_end_seconds"]
        previous["texts"].append(segment["_text"])
        previous["segments"].append(segment)

    for turn in turns:
        turn["text"] = " ".join(turn["texts"]).strip()
    return turns


def transcript_turns(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Build serialized speaker turns from a diarized ASR payload.

    Args:
        payload (dict[str, Any]): A payload with a `document` key, as expected
            by `diarized_segments`.

    Returns:
        list[dict[str, Any]]: The turns, serialized via
            `serialize_speaker_turns` (formatted timestamps, stripped internal
            keys).
    """
    turns = merge_speaker_turns_by_sentence(diarized_segments(payload))
    return serialize_speaker_turns(turns)


def serialize_speaker_turns(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Format merged turns for external consumption (e.g. API responses).

    Args:
        turns (list[dict[str, Any]]): Turns as returned by
            `merge_speaker_turns_by_sentence`.

    Returns:
        list[dict[str, Any]]: The turns with `start`/`end` formatted as
            HH:MM:SS.mmm timestamps and each turn's `segments` stripped of
            internal (`_`-prefixed) keys.
    """
    serialized: list[dict[str, Any]] = []
    for turn in turns:
        serialized.append(
            {
                "speaker": turn["speaker"],
                "speaker_no": turn["speaker_no"],
                "start": format_timestamp(turn["start"]),
                "end": format_timestamp(turn["end"]),
                "text": turn.get("text") or " ".join(turn["texts"]).strip(),
                "segments": [
                    {
                        key: value
                        for key, value in segment.items()
                        if not key.startswith("_")
                    }
                    for segment in turn["segments"]
                ],
            }
        )
    return serialized


def speaker_turns_from_validated_paragraphs(
    paragraphs: list[Any],
) -> list[dict[str, Any]]:
    """
    Build one speaker turn per human-validated paragraph.

    Unlike `merge_speaker_turns_by_sentence`, this does not merge consecutive
    same-speaker paragraphs, since validated paragraphs already reflect the
    reviewer's intended segmentation. Paragraphs with blank text are skipped.

    Args:
        paragraphs (list[Any]): Validated paragraphs (dicts or
            ASRParagraph-like objects), in order.

    Returns:
        list[dict[str, Any]]: One serialized turn per non-blank paragraph.
    """
    turns: list[dict[str, Any]] = []
    for paragraph in paragraphs:
        segment = (
            paragraph
            if isinstance(paragraph, dict)
            else paragraph.model_dump(mode="json")
        )
        text = str(segment.get("text") or "").strip()
        if not text:
            continue

        start = parse_time_seconds(segment["start"])
        end = parse_time_seconds(segment["end"])
        turn_segment = dict(segment)
        turn_segment["text"] = text
        turns.append(
            {
                "speaker": speaker_label(turn_segment),
                "speaker_no": turn_segment["speaker_no"],
                "start": format_timestamp(start),
                "end": format_timestamp(end),
                "text": text,
                "segments": [turn_segment],
            }
        )
    return turns


def markdown_transcript(payload: dict[str, Any], title: str) -> str:
    """
    Render a diarized ASR payload as a Markdown transcript.

    Emits one `## Speaker (start - end)` section per merged turn. Warns if
    fewer than two distinct speakers were detected, since that usually
    indicates a diarization issue rather than a genuinely single-speaker audio.

    Args:
        payload (dict[str, Any]): A payload with a `document` key, as expected
            by `diarized_segments`.
        title (str): The document title, used as the top-level heading.

    Returns:
        str: The rendered Markdown transcript, ending in a single newline.
    """
    segments = diarized_segments(payload)
    turns = merge_speaker_turns_by_sentence(segments)

    distinct_speakers = {turn["speaker"] for turn in turns}
    if len(distinct_speakers) < 2:
        warnings.warn(
            f"Only one speaker label found for {title}; verify the source audio is expected to be single-speaker",
            stacklevel=2,
        )

    lines = [f"# {title}", ""]
    for turn in turns:
        timestamp = (
            f"{format_timestamp(turn['start'])} - {format_timestamp(turn['end'])}"
        )
        lines.append(f"## {turn['speaker']} ({timestamp})")
        lines.append("")
        lines.append(turn.get("text") or " ".join(turn["texts"]).strip())
        lines.append("")

    return "\n".join(lines).strip() + "\n"
