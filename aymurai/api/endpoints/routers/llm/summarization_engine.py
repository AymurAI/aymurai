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

from aymurai.llm_providers import LLMProvider, get_llm_provider
from aymurai.llm_providers.llamacpp_provider import (
    TEMPLATE_OVERHEAD_TOKENS,
    LlamaCppLLMProvider,
)
from aymurai.logger import get_logger
from aymurai.settings import settings
from aymurai.utils.yaml_data import load_yaml

logger = get_logger(__name__)

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


async def _build_provider(
    model_name: str | None,
    *,
    tokenizer_name: str | None,
    system_prompt: str,
    context_limit: int,
    options: dict[str, Any],
) -> tuple[LLMProvider, int | None]:
    """
    Build the configured LLM provider and compute its effective context budget.

    `context_limit` is the caller's *requested* `num_ctx` — for
    `LlamaCppLLMProvider` this is capped at the server's actual configured
    context window (`resolve_served_model().n_ctx`, falling back to
    `n_ctx_train` if the server doesn't report `n_ctx`), since `llama-server`
    fixes its context at launch and a request can't raise it. Ollama has no
    equivalent server-fixed ceiling to discover (and, like llama.cpp, doesn't
    receive `num_ctx` on the OpenAI-compatible request path either — see
    `OpenAICompatibleLLMProvider._translate_options`), so no capping happens
    there and no exact safety-net check is possible; `effective_ctx` is
    `None` in that case.

    From the (possibly capped) ceiling, this reserves the requested output
    budget (`num_predict`), the system prompt's estimated tokens, and — for
    llama.cpp — a fixed chat-template markup margin
    (`TEMPLATE_OVERHEAD_TOKENS`). What's left becomes
    `provider.max_context_tokens`, the budget `chunk_text` sizes chunks to.

    Args:
        model_name: Name of the model to use. None falls back to the
            configured provider's own default model.
        tokenizer_name: Tokenizer name to attempt loading.
        system_prompt: System prompt to set and budget for.
        context_limit: The request's `num_ctx` — an upper bound, not a
            guarantee (see above).
        options: Generation options; reads `num_predict`.

    Returns:
        tuple[LLMProvider, int | None]: The configured provider, and the
            effective context ceiling used to derive its budget (`None` when
            there's no server-fixed ceiling to check against). Callers use
            the latter to run an exact pre-generation safety check via
            `provider.acount_prompt_tokens`.
    """
    encoding = _load_tokenizer(tokenizer_name)
    num_predict = int(options.get("num_predict", settings.LLM_DEFAULT_NUM_PREDICT))

    provider = get_llm_provider(
        model=model_name,
        tokenizer=encoding,
        system_prompt=system_prompt,
    )

    effective_ctx: int | None = None
    template_margin = 0

    if isinstance(provider, LlamaCppLLMProvider):
        effective_ctx = context_limit
        template_margin = TEMPLATE_OVERHEAD_TOKENS
        try:
            served = await provider.aresolve_served_model()
        except Exception:
            logger.warning(
                f"{provider.base_url}: could not resolve the served model to cap "
                "num_ctx against the server's real context window — using the "
                "requested value as-is.",
                exc_info=True,
            )
        else:
            server_ctx = served.n_ctx or served.n_ctx_train
            if server_ctx:
                effective_ctx = min(context_limit, server_ctx)

    reserved_system = _count_tokens(system_prompt, encoding)
    ctx_for_budget = effective_ctx if effective_ctx is not None else context_limit
    provider.max_context_tokens = max(
        ctx_for_budget - num_predict - reserved_system - template_margin, 1
    )

    return provider, effective_ctx


async def _ensure_within_context(
    provider: LLMProvider,
    text: str,
    *,
    options: dict[str, Any],
    effective_ctx: int | None,
) -> str:
    """
    Verify a prompt's exact token count fits before generation, trimming further if not.

    A no-op when `effective_ctx` is `None` (no server-fixed ceiling to check
    against — see `_build_provider`). Otherwise this is the actual guarantee
    that no request exceeds the effective context: `chunk_text`'s estimate-based
    sizing already keeps this rare, but `count_prompt_tokens`/`acount_prompt_tokens`
    can be exact (llama.cpp) where the chunking estimate can't be.

    Args:
        provider: The provider about to receive `text` as a prompt.
        text: The prompt about to be sent.
        options: Generation options forwarded to the model; reads `num_predict`.
        effective_ctx: The effective context ceiling from `_build_provider`,
            or `None`.

    Returns:
        str: `text` unchanged if it already fits, otherwise a trimmed version.
    """
    if effective_ctx is None:
        return text

    num_predict = int(options.get("num_predict", settings.LLM_DEFAULT_NUM_PREDICT))
    prompt_tokens = await provider.acount_prompt_tokens(prompt=text)

    if prompt_tokens + num_predict <= effective_ctx:
        return text

    logger.warning(
        f"Prompt ({prompt_tokens} tokens) + reserved output ({num_predict}) "
        f"exceeds the effective context ({effective_ctx}) — trimming further."
    )
    return _trim_to_context(provider, text)


async def _summarize_once(
    provider: LLMProvider,
    *,
    text: str,
    options: dict[str, Any],
    effective_ctx: int | None = None,
) -> str:
    """
    Run a single summarization call on the provider.

    Args:
        provider: Initialized LLMProvider instance.
        text: Chunk or combined text to summarize.
        options: Provider options forwarded to the model.
        effective_ctx: The effective context ceiling from `_build_provider`,
            used for an exact pre-generation safety check. `None` skips it.

    Returns:
        str: The model's text output for the given input.
    """
    text = await _ensure_within_context(
        provider, text, options=options, effective_ctx=effective_ctx
    )
    response = await provider.async_generate(prompt=text, options=options)
    return response.text


async def _rolling_summarize(
    provider: LLMProvider,
    *,
    text: str,
    options: dict[str, Any],
    effective_ctx: int | None = None,
) -> tuple[str, list[SummarizationStep], int]:
    """
    Summarize potentially long text by chunking and rolling summaries forward.

    Args:
        provider: Initialized LLMProvider instance.
        text: Full document text to summarize.
        options: Provider options forwarded to the model.
        effective_ctx: The effective context ceiling from `_build_provider`,
            forwarded to `_summarize_once`'s exact safety check. `None` skips it.

    Returns:
        tuple[str, list[SummarizationStep], int]: A tuple of (final_summary, steps_metadata, chunk_count).
    """
    chunks = provider.chunk_text(text, max_tokens=provider.max_context_tokens)
    if not chunks:
        return "", [], 0

    steps = []
    summary = await _summarize_once(
        provider, text=chunks[0].text, options=options, effective_ctx=effective_ctx
    )
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
                effective_ctx=effective_ctx,
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
            effective_ctx=effective_ctx,
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


def _trim_to_context(provider: LLMProvider, text: str) -> str:
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
