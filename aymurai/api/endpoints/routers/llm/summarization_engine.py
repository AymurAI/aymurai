"""Summarization engine: prompts, tokenization, chunking and rolling summaries.

Holds the summarization logic and the data types it produces, so the router
modules stay thin orchestration layers (CES-8). Imported by
`summarization.py` (generation routes) and `summary_validation.py`
(human-validation routes).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import tiktoken
from fastapi import HTTPException
from pydantic import BaseModel

from aymurai.llm_providers import OllamaLLMProvider
from aymurai.logger import get_logger
from aymurai.settings import settings
from aymurai.utils.yaml_data import load_yaml

logger = get_logger(__name__)

DEFAULT_MODEL = "gpt-oss:20b"
DEFAULT_OPTIONS = {"num_ctx": 16_384, "num_predict": 4096}
DEFAULT_TOKENIZER = "o200k_harmony"
PROMPT_TEMPLATE_PATH = Path(settings.RESOURCES_BASEPATH) / "llm" / "summarization.yml"


def _load_prompt_defaults(path: Path) -> tuple[str, str]:
    """
    Load default placeholders from the YAML template,
    ensuring both required fields are present.

    Args:
        path: Path to the summarization YAML file.

    Returns:
        tuple[str, str]: Defaults for `information_to_extract` and `entities_to_identify`.

    Raises:
        FileNotFoundError: If the YAML file cannot be located.
        RuntimeError: If the defaults block is missing or incomplete.
    """
    content = load_yaml(str(path))
    defaults = content.get("defaults", {})
    info = (defaults.get("information-to-extract") or "").strip()
    entities = (defaults.get("entities-to-identify") or "").strip()
    if not info or not entities:
        raise RuntimeError("summarization defaults missing in YAML")
    return info, entities


DEFAULT_INFORMATION_TO_EXTRACT, DEFAULT_ENTITIES_TO_IDENTIFY = _load_prompt_defaults(
    PROMPT_TEMPLATE_PATH
)


class SummarizationStep(BaseModel):
    chunk_index: int
    input_tokens: int
    source: str


class SummarizationConfig(BaseModel):
    """The generation config that produced a stored summary.

    Persisted alongside the summary and echoed back on every read. It is
    informational only: the cache key is the source text alone, so a differing
    config never triggers regeneration.
    """

    model: str
    system_prompt: str
    tokenizer: str | None = None
    options: dict[str, Any]


def _load_template_prompt(
    *,
    information_to_extract: str | None,
    entities_to_identify: str | None,
) -> str:
    """
    Load and format the summarization prompt template.

    Args:
        information_to_extract: Template placeholder describing what to extract.
        entities_to_identify: Template placeholder listing entities to detect.

    Returns:
        str: Formatted system prompt for summarization.

    Raises:
        HTTPException: If the template file is missing or cannot be parsed.
    """
    path = PROMPT_TEMPLATE_PATH
    try:
        content = load_yaml(str(path))
        template = content["system-prompts"]["template"]

    except FileNotFoundError as exc:
        logger.exception(f"Summarization prompt template not found at {path}")
        raise HTTPException(
            status_code=500,
            detail="Summarization prompt template not found.",
        ) from exc
    except Exception as exc:
        logger.exception("Error loading summarization prompt template.")
        raise HTTPException(
            status_code=500,
            detail="Unable to load summarization prompt template.",
        ) from exc

    info = information_to_extract or DEFAULT_INFORMATION_TO_EXTRACT
    entities = entities_to_identify or DEFAULT_ENTITIES_TO_IDENTIFY

    return template.format(
        information_to_extract=info,
        entities_to_identify=entities,
    )


def _load_tokenizer(tokenizer_name: str | None) -> tiktoken.Encoding | None:
    """
    Load a tiktoken tokenizer by name.

    Args:
        tokenizer_name (str | None): Name of the tokenizer to load.

    Returns:
        tiktoken.Encoding | None: The loaded tokenizer encoding or None if unavailable.
    """
    if not tokenizer_name:
        return None

    try:
        return tiktoken.get_encoding(tokenizer_name)

    except Exception:
        logger.warning(
            f"Tokenizer {tokenizer_name} is not available. Falling back to whitespace."
        )
        return None


def _count_tokens(text: str, tokenizer: Any) -> int:
    """
    Count the number of tokens in the given text using the provided tokenizer.

    Args:
        text (str): The input text to count tokens for.
        tokenizer (Any): The tokenizer to use for counting tokens.

    Returns:
        int: The number of tokens in the input text.
    """
    if tokenizer is None:
        return len(text.split())
    try:
        return len(tokenizer.encode(text))
    except Exception:
        return len(text.split())


def _build_provider(
    model_name: str,
    *,
    tokenizer_name: str | None,
    system_prompt: str,
    context_limit: int,
) -> OllamaLLMProvider:
    """
    Build an Ollama provider, adjusting available context for the system prompt.

    Args:
        model_name: Name of the model to use.
        tokenizer_name: Tokenizer name to attempt loading.
        system_prompt: System prompt to set and budget for.
        context_limit: Maximum number of context tokens.

    Returns:
        OllamaLLMProvider: Configured OllamaLLMProvider instance.
    """
    encoding = _load_tokenizer(tokenizer_name)
    available_context = max(context_limit - _count_tokens(system_prompt, encoding), 1)

    return OllamaLLMProvider(
        model=model_name,
        tokenizer=encoding,
        system_prompt=system_prompt,
        max_context_tokens=available_context,
    )


async def _summarize_once(
    provider: OllamaLLMProvider,
    *,
    text: str,
    options: dict[str, Any],
) -> str:
    """
    Run a single summarization call on the provider.

    Args:
        provider: Initialized OllamaLLMProvider instance.
        text: Chunk or combined text to summarize.
        options: Provider options forwarded to the model.

    Returns:
        str: The model's text output for the given input.
    """
    response = await provider.async_generate(prompt=text, options=options)
    return response.text


async def _rolling_summarize(
    provider: OllamaLLMProvider,
    *,
    text: str,
    options: dict[str, Any],
) -> tuple[str, list[SummarizationStep], int]:
    """
    Summarize potentially long text by chunking and rolling summaries forward.

    Args:
        provider: Initialized OllamaLLMProvider instance.
        text: Full document text to summarize.
        options: Provider options forwarded to the model.

    Returns:
        tuple[str, list[SummarizationStep], int]: A tuple of (final_summary, steps_metadata, chunk_count).
    """
    chunks = provider.chunk_text(text, max_tokens=provider.max_context_tokens)
    if not chunks:
        return "", [], 0

    steps = []
    summary = await _summarize_once(provider, text=chunks[0].text, options=options)
    steps.append(
        SummarizationStep(
            chunk_index=chunks[0].index,
            input_tokens=chunks[0].token_count,
            source="chunk",
        )
    )

    for chunk in chunks[1:]:
        combined_text = f"{summary}\n\n{chunk.text}"
        combined_tokens = provider.count_tokens(combined_text)

        if (
            provider.max_context_tokens
            and combined_tokens > provider.max_context_tokens
        ):
            chunk_summary = await _summarize_once(
                provider,
                text=chunk.text,
                options=options,
            )
            steps.append(
                SummarizationStep(
                    chunk_index=chunk.index,
                    input_tokens=chunk.token_count,
                    source="chunk",
                )
            )
            combined_text = f"{summary}\n\n{chunk_summary}"
            combined_tokens = provider.count_tokens(combined_text)

            if (
                provider.max_context_tokens
                and combined_tokens > provider.max_context_tokens
            ):
                trimmed_parts = []
                for part in provider.chunk_text(
                    combined_text, max_tokens=provider.max_context_tokens
                ):
                    tentative = " ".join(trimmed_parts + [part.text])
                    if (
                        provider.max_context_tokens
                        and provider.count_tokens(tentative)
                        > provider.max_context_tokens
                    ):
                        break
                    trimmed_parts.append(part.text)
                combined_text = " ".join(trimmed_parts)
                combined_tokens = provider.count_tokens(combined_text)

        summary = await _summarize_once(
            provider,
            text=combined_text,
            options=options,
        )
        steps.append(
            SummarizationStep(
                chunk_index=chunk.index,
                input_tokens=combined_tokens,
                source="summary+chunk",
            )
        )

    return summary, steps, len(chunks)


def _build_sse_message(payload: dict[str, Any]) -> str:
    """
    Format a payload as an SSE data message.

    Args:
        payload: Dictionary to serialize into the SSE data field.

    Returns:
        str: Serialized SSE message string.
    """
    return f"data: {json.dumps(payload)}\n\n"


def _trim_to_context(provider: OllamaLLMProvider, text: str) -> str:
    """
    Trim combined text to respect the provider's context window.

    Args:
        provider: Provider with a configured max_context_tokens.
        text: Concatenated summary and chunk text.

    Returns:
        str: Text trimmed to fit within the context limit.
    """
    if not provider.max_context_tokens:
        return text

    trimmed_parts: list[str] = []
    for part in provider.chunk_text(text, max_tokens=provider.max_context_tokens):
        tentative = " ".join(trimmed_parts + [part.text])
        if (
            provider.max_context_tokens
            and provider.count_tokens(tentative) > provider.max_context_tokens
        ):
            break
        trimmed_parts.append(part.text)

    return " ".join(trimmed_parts)
