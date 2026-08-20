"""Summarization engine: prompts, tokenization, chunking and rolling summaries.

Holds the summarization logic and the data types it produces, so the router
modules stay thin orchestration layers (CES-8). Imported by
`summarization.py` (generation routes) and `summary_validation.py`
(human-validation routes).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel

from aymurai.api.endpoints.routers.llm.chunking import take_window
from aymurai.llm_providers.llamacpp_provider import LlamaCppLLMProvider
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


# Slots are measured with a sentinel rather than an empty string: an empty slot
# lets the surrounding newlines collapse into a run that tokenizes differently,
# which silently under-measures the scaffold.
SENTINEL = "X"

ROLLING_USER_TEMPLATE = "[RESUMEN PARCIAL]\n{summary}\n\n[NUEVO FRAGMENTO]\n{chunk}"


class ContextTooSmallError(Exception):
    """The server's context cannot fit the prompt scaffolding plus any document."""


@dataclass(frozen=True)
class ContextBudget:
    """Exact, server-authoritative token budget for one summarization run."""

    effective_ctx: int
    scaffold_first: int
    scaffold_rolling: int
    reserved_output: int

    @property
    def first_window_budget(self) -> int:
        """Tokens available for document text in the first window."""
        return self.effective_ctx - self.scaffold_first - self.reserved_output

    def rolling_window_budget(self, summary_tokens: int) -> int:
        """
        Tokens available for document text in a follow-up window.

        Args:
            summary_tokens (int): Exact token count of the summary carried
                forward. Measured rather than worst-cased at
                `reserved_output`, which would waste a large slice of every
                window.

        Returns:
            int: Remaining budget; may be non-positive, which callers treat as
                "the carried summary no longer leaves room".
        """
        return (
            self.effective_ctx
            - self.scaffold_rolling
            - self.reserved_output
            - summary_tokens
        )


async def build_context_budget(
    provider: LlamaCppLLMProvider,
    *,
    system_prompt: str,
    rolling_system_prompt: str,
    max_tokens: int,
) -> ContextBudget:
    """
    Measure the exact context budget for a summarization run.

    The scaffold costs are measured against the server's real chat template, so
    the arithmetic matches `usage.prompt_tokens` exactly rather than
    approximating it.

    Args:
        provider: A resolved llama.cpp provider.
        system_prompt: System prompt for the first window.
        rolling_system_prompt: System prompt for follow-up windows.
        max_tokens: Output tokens reserved per generation.

    Raises:
        ContextTooSmallError: If no document tokens fit in either window shape.

    Returns:
        ContextBudget: The measured budget.
    """
    served = await provider.aresolve_served_model()
    server_ctx = served.n_ctx or served.n_ctx_train
    if not server_ctx:
        raise ContextTooSmallError(
            f"{provider.base_url} reported no context window (n_ctx/n_ctx_train)"
        )

    cap = settings.LLM_MAX_CONTEXT_TOKENS
    effective_ctx = min(server_ctx, cap) if cap else server_ctx

    sentinel_tokens = len(await provider.atokenize(SENTINEL))

    first_probe = await provider.acount_prompt_tokens(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": SENTINEL},
        ]
    )
    rolling_probe = await provider.acount_prompt_tokens(
        messages=[
            {"role": "system", "content": rolling_system_prompt},
            {
                "role": "user",
                "content": ROLLING_USER_TEMPLATE.format(
                    summary=SENTINEL, chunk=SENTINEL
                ),
            },
        ]
    )

    budget = ContextBudget(
        effective_ctx=effective_ctx,
        scaffold_first=first_probe - sentinel_tokens,
        scaffold_rolling=rolling_probe - 2 * sentinel_tokens,
        reserved_output=max_tokens,
    )

    if budget.first_window_budget <= 0:
        raise ContextTooSmallError(
            f"context window {effective_ctx} leaves no room for document text "
            f"after the system prompt ({budget.scaffold_first} tokens) and "
            f"reserved output ({max_tokens} tokens) — lower max_tokens, shorten "
            f"the system prompt, or raise the server's -c value"
        )

    return budget


def load_rolling_prompt(
    *,
    information_to_extract: str | None,
    entities_to_identify: str | None,
) -> str:
    """
    Load the rolling-pass system prompt.

    Distinct from the first-pass prompt: this one instructs the model to
    consolidate an existing partial summary with a new fragment rather than to
    summarize a document from scratch.

    Args:
        information_to_extract: Template placeholder.
        entities_to_identify: Template placeholder.

    Raises:
        HTTPException: If the template file is missing or unparseable.

    Returns:
        str: The formatted rolling system prompt.
    """
    try:
        content = load_yaml(str(PROMPT_TEMPLATE_PATH))
        template = content["system-prompts"]["rolling"]
    except Exception as exc:
        logger.exception("Error loading the rolling summarization prompt.")
        raise HTTPException(
            status_code=500,
            detail="Unable to load the rolling summarization prompt.",
        ) from exc

    return template.format(
        information_to_extract=information_to_extract or DEFAULT_INFORMATION_TO_EXTRACT,
        entities_to_identify=entities_to_identify or DEFAULT_ENTITIES_TO_IDENTIFY,
    )


async def prepare_run(
    model: str | None,
    *,
    system_prompt: str,
    rolling_system_prompt: str,
    max_tokens: int,
) -> tuple[LlamaCppLLMProvider, ContextBudget]:
    """
    Build a provider bound to the server's real model, and measure its budget.

    `llama-server` ignores the request's `model` field and serves whatever it
    was launched with, so the constructor's placeholder is replaced by the
    server's own id — making the `model` we report and persist genuine
    provenance instead of a constant.

    Args:
        model: Optional caller override. Inert on a single-model server, but
            honoured if supplied.
        system_prompt: First-pass system prompt.
        rolling_system_prompt: Follow-up system prompt.
        max_tokens: Output tokens reserved per generation.

    Raises:
        ContextTooSmallError: Propagated from `build_context_budget`.

    Returns:
        tuple[LlamaCppLLMProvider, ContextBudget]: The ready provider and its
            measured budget. The caller owns closing the provider.
    """
    provider = LlamaCppLLMProvider(model=model, system_prompt=system_prompt)

    budget = await build_context_budget(
        provider,
        system_prompt=system_prompt,
        rolling_system_prompt=rolling_system_prompt,
        max_tokens=max_tokens,
    )

    if not model:
        served = await provider.aresolve_served_model()
        provider.model_name = served.id

    return provider, budget


@dataclass(frozen=True)
class TokenEvent:
    """One streamed token of the in-progress summary."""

    chunk_index: int
    source: str
    text: str


@dataclass(frozen=True)
class StepEvent:
    """A completed window's metadata."""

    step: SummarizationStep


@dataclass(frozen=True)
class DoneEvent:
    """Terminal event carrying the final summary."""

    summary: str
    chunks_used: int


class EmptyCompletionError(Exception):
    """The model returned no content, having spent its budget on reasoning."""


async def summarize_events(
    provider: LlamaCppLLMProvider,
    *,
    text: str,
    budget: ContextBudget,
    options: dict[str, Any],
    system_prompt: str,
    rolling_system_prompt: str,
) -> AsyncIterator[TokenEvent | StepEvent | DoneEvent]:
    """
    Summarize a document, rolling the summary forward across windows.

    Tokenizes once, then consumes the document adaptively: each window's budget
    is computed from the *measured* prior summary, so a short summary leaves
    more room for document text than a worst-case reservation would.

    Args:
        provider: A resolved llama.cpp provider.
        text: Full document text.
        budget: Measured context budget.
        options: OpenAI generation parameters forwarded to the model.
        system_prompt: System prompt for the first window.
        rolling_system_prompt: System prompt for follow-up windows.

    Raises:
        ContextTooSmallError: If a window's budget collapses to nothing.
        EmptyCompletionError: If the model returns empty content.

    Yields:
        TokenEvent | StepEvent | DoneEvent: Progress, then exactly one
            terminal `DoneEvent`.
    """
    cleaned = text.strip()
    if not cleaned:
        yield DoneEvent(summary="", chunks_used=0)
        return

    pieces = await provider.atokenize_pieces(cleaned)
    overlap = settings.LLM_CHUNK_OVERLAP_TOKENS

    summary = ""
    start = 0
    index = 0

    while start < len(pieces):
        if index == 0:
            window_budget = budget.first_window_budget
            active_system_prompt = system_prompt
        else:
            summary_tokens = len(await provider.atokenize(summary))
            window_budget = budget.rolling_window_budget(summary_tokens)
            active_system_prompt = rolling_system_prompt

        if window_budget <= 0:
            raise ContextTooSmallError(
                f"window {index} has no room left for document text — the "
                f"carried summary is too long for context {budget.effective_ctx}"
            )

        window = take_window(pieces, start, max_tokens=window_budget, overlap=overlap)

        user_content = (
            window.text
            if index == 0
            else ROLLING_USER_TEMPLATE.format(summary=summary, chunk=window.text)
        )
        messages = [
            {"role": "system", "content": active_system_prompt},
            {"role": "user", "content": user_content},
        ]

        prompt_tokens = await provider.acount_prompt_tokens(messages=messages)
        if prompt_tokens + budget.reserved_output > budget.effective_ctx:
            raise ContextTooSmallError(
                f"assembled prompt ({prompt_tokens}) plus reserved output "
                f"({budget.reserved_output}) exceeds context "
                f"({budget.effective_ctx}) at window {index}"
            )

        source = "chunk" if index == 0 else "summary+chunk"
        generated = ""
        finish_reason = None
        async for response in provider.async_stream(
            prompt=user_content, system_prompt=active_system_prompt, **options
        ):
            finish_reason = response.metadata.get("finish_reason") or finish_reason
            if not response.text:
                continue
            generated += response.text
            yield TokenEvent(chunk_index=index, source=source, text=response.text)

        if not generated.strip():
            raise EmptyCompletionError(
                f"model returned no content at window {index} "
                f"(finish_reason={finish_reason!r}) — it likely spent all "
                f"{budget.reserved_output} max_tokens on reasoning; raise "
                "max_tokens, or bound reasoning on the server via "
                "LLAMA_ARG_THINK_BUDGET / LLAMA_ARG_REASONING=off"
            )

        summary = generated.strip()
        yield StepEvent(
            step=SummarizationStep(
                chunk_index=index, input_tokens=prompt_tokens, source=source
            )
        )

        start = window.next_start
        index += 1

    yield DoneEvent(summary=summary, chunks_used=index)


def _build_sse_message(payload: dict[str, Any]) -> str:
    """
    Format a payload as an SSE data message.

    Args:
        payload: Dictionary to serialize into the SSE data field.

    Returns:
        str: Serialized SSE message string.
    """
    return f"data: {json.dumps(payload)}\n\n"
